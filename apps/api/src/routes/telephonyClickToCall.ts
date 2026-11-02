import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { placeClickToCall, type ClickToCallPhoneField } from '../services/clickToCall';
import { EffectivePermissionService } from '../services/effectivePermissions';
import { prisma } from '@dct-crm/db';
import { DEFAULT_DIALPAD_URL } from '../services/telephonyUrl';
import { canAccessLead } from '../services/recordAccess';
import { normalizeLeadPhone } from '../services/leadDuplicateDetection';
import { applyCallLogStatusRule } from '../services/callLogStatus';
import { decryptTelephonyToken, TelephonyCredentialError } from '../services/telephonyCredentials';

const router = Router();
router.use(authenticate);

const requestSchema = z.object({
  leadId: z.string().trim().min(1),
  phoneField: z.enum(['phone', 'mobile', 'secondaryPhone']).optional(),
});
const dialpadCallSchema = z.object({
  leadId: z.string().trim().min(1),
  phoneField: z.enum(['phone', 'mobile', 'secondaryPhone']).default('phone'),
});
const dialpadEventSchema = z.object({
  callUuid: z.string().trim().max(255).optional(),
  leadId: z.string().trim().min(1).max(255),
  type: z.enum(['BIZCALL_CALL_STARTING', 'BIZCALL_CALL_CONNECTED', 'BIZCALL_CALL_ENDED', 'BIZCALL_DISPOSITION_SUBMITTED']),
  duration: z.number().int().min(0).max(86_400).optional(),
  disposition: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
});
const dialpadRecentCalls = new Map<string, number>();
const dialpadRateHits = new Map<string, number[]>();

function reserveDialpadCall(userId: string, leadId: string, now: number, duplicateSeconds: number, perMinute: number) {
  for (const [key, timestamp] of dialpadRecentCalls) {
    if (now - timestamp >= 120_000) dialpadRecentCalls.delete(key);
  }
  for (const [key, timestamps] of dialpadRateHits) {
    const activeTimestamps = timestamps.filter((timestamp) => now - timestamp < 60_000);
    if (activeTimestamps.length) dialpadRateHits.set(key, activeTimestamps);
    else dialpadRateHits.delete(key);
  }
  const recentKey = `${userId}:${leadId}`;
  const previous = dialpadRecentCalls.get(recentKey);
  if (previous !== undefined && now - previous < duplicateSeconds * 1000) return 'duplicate';
  const hits = dialpadRateHits.get(userId) || [];
  if (hits.length >= perMinute) {
    dialpadRateHits.set(userId, hits);
    return 'rate';
  }
  hits.push(now);
  dialpadRateHits.set(userId, hits);
  dialpadRecentCalls.set(recentKey, now);
  return null;
}

router.get('/client-config', async (req: AuthRequest, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!(await EffectivePermissionService.hasPermission(req.user!.id, 'TELEPHONY_CALL'))) {
      return res.json({
        success: true,
        ok: false,
        data: { active: false, reasonCode: 'NO_PERMISSION' },
      });
    }
    const settings = await prisma.telephonySetting.findUnique({ where: { tenantId: req.tenantId! } });
    if (!settings) {
      return res.json({ success: true, ok: false, data: { active: false, reasonCode: 'NOT_CONFIGURED' } });
    }
    if (!settings.isActive) {
      return res.json({ success: true, ok: false, data: { active: false, reasonCode: 'DISABLED' } });
    }
    if (!settings.encryptedCredentials) {
      return res.json({ success: true, ok: false, data: { active: false, reasonCode: 'KEY_MISSING' } });
    }
    try {
      decryptTelephonyToken(settings.encryptedCredentials);
    } catch (error) {
      if (error instanceof TelephonyCredentialError) {
        return res.json({
          success: true,
          ok: false,
          data: {
            active: false,
            reasonCode: 'KEY_UNREADABLE',
          },
        });
      }
      throw error;
    }
    const dialpadUrl = settings?.dialpadUrl || DEFAULT_DIALPAD_URL;
    return res.json({
      success: true,
      ok: true,
      data: {
        active: true,
        reasonCode: 'ACTIVE',
        dialpadUrl,
        dialpadOrigin: new URL(dialpadUrl).origin,
        dialpadMode: settings?.dialpadMode || 'DOCKED',
        callMethod: settings?.callMethod || 'SERVER_API',
        theme: settings?.theme || 'CRM',
        defaultDockState: settings?.defaultDockState || 'COLLAPSED',
        maskNumbers: Boolean(settings?.maskNumbers),
      },
    });
  } catch (error) {
    console.error('Telephony client config error', error instanceof Error ? error.name : 'error');
    return res.status(503).json({
      success: false,
      ok: false,
      code: 'TELEPHONY_CONFIG_UNAVAILABLE',
      message: 'Telephony settings could not be loaded.',
    });
  }
});

router.post('/dialpad-call-started', async (req: AuthRequest, res: Response) => {
  const parsed = dialpadCallSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, ok: false, code: 'INVALID_REQUEST', message: parsed.error.errors[0]?.message || 'Invalid call request.' });
  if (!(await EffectivePermissionService.hasPermission(req.user!.id, 'TELEPHONY_CALL'))) {
    return res.status(403).json({ success: false, ok: false, code: 'NO_PERMISSION', message: 'Telephony permission is required.' });
  }
  try {
    const [settings, lead] = await Promise.all([
      prisma.telephonySetting.findUnique({ where: { tenantId: req.tenantId! } }),
      prisma.lead.findFirst({
        where: { id: parsed.data.leadId, tenantId: req.tenantId! },
        select: {
          id: true, tenantId: true, ownerId: true, creatorId: true, firstName: true, lastName: true,
          company: true, phone: true, mobile: true, secondaryPhone: true, countryCode: true,
          secondaryCountryCode: true, leadNumber: true, status: true,
        },
      }),
    ]);
    if (!settings?.isActive || !settings.encryptedCredentials) {
      return res.status(409).json({ success: false, ok: false, code: 'TELEPHONY_KEY_MISSING', message: 'Telephony key is missing. Ask an admin to add it in Setup > Integrations > Telephony.' });
    }
    if (settings.callMethod !== 'DIALPAD_MESSAGE') {
      return res.status(409).json({ success: false, ok: false, code: 'WRONG_CALL_METHOD', message: 'Dialpad messaging is not the active call method.' });
    }
    if (!lead || !(await canAccessLead(req.user!, lead))) {
      return res.status(404).json({ success: false, ok: false, code: 'LEAD_NOT_FOUND', message: 'Lead not found.' });
    }
    const selected = parsed.data.phoneField === 'mobile'
      ? { phone: lead.mobile, countryCode: lead.countryCode }
      : parsed.data.phoneField === 'secondaryPhone'
        ? { phone: lead.secondaryPhone, countryCode: lead.secondaryCountryCode }
        : { phone: lead.phone, countryCode: lead.countryCode };
    const normalized = normalizeLeadPhone(selected.phone, selected.countryCode);
    if (!normalized) return res.status(422).json({ success: false, ok: false, code: 'INVALID_PHONE', message: 'Enter a valid phone number.' });
    if (settings.blockDnc && settings.dncNumbers.split(/[\s,;]+/).includes(normalized.e164)) {
      return res.status(409).json({ success: false, ok: false, code: 'DO_NOT_CALL', message: 'This number is on the Do-Not-Call list.' });
    }
    const guard = reserveDialpadCall(req.user!.id, lead.id, Date.now(), settings.duplicateGuardSeconds, settings.callsPerMinute);
    if (guard === 'duplicate') return res.status(409).json({ success: false, ok: false, code: 'DUPLICATE_CLICK', message: 'A call to this lead was just started.' });
    if (guard === 'rate') return res.status(429).json({ success: false, ok: false, code: 'RATE_LIMITED', message: 'Too many calls. Wait a minute and try again.' });
    const since = new Date(Date.now() - settings.duplicateGuardSeconds * 1000);
    const duplicate = await prisma.callDetail.findFirst({
      where: { tenantId: req.tenantId!, createdById: req.user!.id, leadId: lead.id, source: 'dialpad', startAt: { gte: since } },
      select: { id: true },
    });
    if (duplicate) return res.status(409).json({ success: false, ok: false, code: 'DUPLICATE_CLICK', message: 'A call to this lead was just started.', data: { callDetailId: duplicate.id } });
    const displayName = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() || lead.company || 'Unknown';
    const now = new Date();
    const call = await prisma.$transaction(async (tx) => {
      const created = await tx.callDetail.create({
        data: {
          tenantId: req.tenantId!,
          leadId: lead.id,
          name: `Dialpad call ${lead.leadNumber || 'lead'} ${now.getTime()}`.slice(0, 255),
          callType: 'OUTBOUND',
          callTo: normalized.e164,
          status: 'Initiated',
          startAt: now,
          endAt: now,
          duration: 0,
          createdById: req.user!.id,
          ownerId: req.user!.id,
          source: 'dialpad',
        },
        select: { id: true },
      });
      await applyCallLogStatusRule(lead.id, tx, { tenantId: req.tenantId!, userId: req.user!.id, callLogId: created.id });
      return created;
    });
    return res.status(201).json({ success: true, ok: true, data: { callDetailId: call.id, leadId: lead.id, leadName: displayName, dialNumber: normalized.e164 } });
  } catch (error) {
    console.error('Dialpad call-started error', error instanceof Error ? error.name : 'error');
    return res.status(500).json({ success: false, ok: false, code: 'CALL_START_FAILED', message: 'The call could not be recorded.' });
  }
});

router.post('/dialpad-event', async (req: AuthRequest, res: Response) => {
  const parsed = dialpadEventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, ok: false, code: 'INVALID_EVENT', message: 'Invalid dialpad event.' });
  if (!(await EffectivePermissionService.hasPermission(req.user!.id, 'TELEPHONY_CALL'))) {
    return res.status(403).json({ success: false, ok: false, code: 'NO_PERMISSION', message: 'Telephony permission is required.' });
  }
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: parsed.data.leadId, tenantId: req.tenantId! },
      select: { id: true, tenantId: true, ownerId: true, creatorId: true },
    });
    if (!lead || !(await canAccessLead(req.user!, lead))) {
      return res.status(404).json({ success: false, ok: false, code: 'LEAD_NOT_FOUND', message: 'Lead not found.' });
    }
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const call = await prisma.callDetail.findFirst({
      where: {
        tenantId: req.tenantId!,
        leadId: lead.id,
        createdById: req.user!.id,
        callType: 'OUTBOUND',
        startAt: { gte: fiveMinutesAgo },
        OR: parsed.data.callUuid
          ? [{ providerCallId: parsed.data.callUuid }, { source: 'dialpad', providerCallId: null }]
          : [{ source: 'dialpad' }, { providerCallId: { not: null } }],
      },
      orderBy: { startAt: 'desc' },
      select: { id: true },
    });
    if (!call) return res.status(404).json({ success: false, ok: false, code: 'CALL_NOT_FOUND', message: 'No matching dialpad call was found.' });
    const event = parsed.data;
    const now = new Date();
    const update: Record<string, unknown> = {
      lastModifiedById: req.user!.id,
      source: 'dialpad',
    };
    if (event.callUuid) update.providerCallId = event.callUuid;
    if (event.type === 'BIZCALL_CALL_STARTING') update.status = 'Calling';
    if (event.type === 'BIZCALL_CALL_CONNECTED') update.status = 'Connected';
    if (event.type === 'BIZCALL_CALL_ENDED') {
      update.status = 'Completed';
      update.endAt = now;
      if (event.duration !== undefined) update.duration = event.duration;
    }
    if (event.type === 'BIZCALL_DISPOSITION_SUBMITTED') {
      update.disposition = event.disposition || null;
      update.notes = event.notes || null;
    }
    if (event.duration !== undefined && event.type !== 'BIZCALL_CALL_ENDED') update.duration = event.duration;
    await prisma.callDetail.update({ where: { id: call.id }, data: update });
    return res.json({ success: true, ok: true, data: { callDetailId: call.id, type: event.type } });
  } catch (error) {
    console.error('Dialpad event error', error instanceof Error ? error.name : 'error');
    return res.status(500).json({ success: false, ok: false, code: 'DIALPAD_EVENT_FAILED', message: 'The call event could not be recorded.' });
  }
});

export function readClickToCallRequest(body: unknown): { leadId: string; phoneField: ClickToCallPhoneField } {
  const parsed = requestSchema.parse(body ?? {});
  return { leadId: parsed.leadId, phoneField: parsed.phoneField ?? 'phone' };
}

router.post('/click-to-call', async (req: AuthRequest, res: Response) => {
  try {
    const request = readClickToCallRequest(req.body);
    const result = await placeClickToCall({
      user: req.user!,
      tenantId: req.tenantId!,
      leadId: request.leadId,
      phoneField: request.phoneField,
    });
    return res.status(result.httpStatus).json({
      success: result.ok,
      ok: result.ok,
      code: result.code,
      message: result.message,
      step: result.step,
      ...(result.ok ? {} : { error: result.message }),
      data: {
        ignored: Boolean(result.ignored),
        callDetailId: result.callDetailId || null,
        leadStatus: result.leadStatus || null,
        statusChanged: Boolean(result.statusChanged),
        leadName: result.leadName || null,
        providerStatus: result.providerStatus ?? null,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const message = error.errors[0]?.message || 'A lead is required.';
      return res.status(400).json({ success: false, ok: false, code: 'INVALID_REQUEST', message, step: 'blocked_before_send', error: message });
    }
    console.error('Click-to-call error', error instanceof Error ? error.name : 'error');
    return res.status(500).json({ success: false, ok: false, code: 'CALL_FAILED', message: 'The call could not be started.', step: 'blocked_before_send', error: 'The call could not be started.' });
  }
});

export default router;
