import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { maskPhone, placeClickToCall, type ClickToCallPhoneField } from '../services/clickToCall';
import { EffectivePermissionService } from '../services/effectivePermissions';
import { prisma, type Prisma } from '@dct-crm/db';
import { DEFAULT_DIALPAD_URL } from '../services/telephonyUrl';
import { canAccessLead } from '../services/recordAccess';
import { normalizeLeadPhone } from '../services/leadDuplicateDetection';
import { applyCallLogStatusRule } from '../services/callLogStatus';
import { decryptTelephonyToken, TelephonyCredentialError } from '../services/telephonyCredentials';
import { appendLeadProcessNote } from '../services/leadNotes';

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
const manualDialpadCallSchema = z.object({
  number: z.string().trim().regex(/^\+[1-9]\d{1,14}$/),
}).strict();
const dialpadEventSchema = z.object({
  event: z.enum([
    'BIZCALL_AGENT_REGISTERED',
    'BIZCALL_CALL_STARTING',
    'BIZCALL_CALL_CONNECTED',
    'BIZCALL_CALL_ENDED',
    'BIZCALL_DISPOSITION_SUBMITTED',
  ]),
  leadId: z.string().trim().min(1).max(255).optional(),
  callUuid: z.string().trim().min(1).max(255).optional(),
  number: z.string().trim().regex(/^\+[1-9]\d{1,14}$/).optional(),
  duration: z.number().int().min(0).max(86_400).optional(),
  durationFormatted: z.string().trim().max(32).optional(),
  disposition: z.string().trim().min(1).max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  extension: z.string().trim().min(1).max(40).optional(),
  tenantId: z.string().max(128).optional(),
  userId: z.string().max(128).optional(),
}).strict().superRefine((event, context) => {
  const requiredByEvent: Partial<Record<typeof event.event, (keyof typeof event)[]>> = {
    BIZCALL_AGENT_REGISTERED: ['name', 'extension'],
    BIZCALL_CALL_STARTING: ['number'],
    BIZCALL_CALL_CONNECTED: ['number', 'callUuid'],
    BIZCALL_CALL_ENDED: ['duration', 'durationFormatted'],
    BIZCALL_DISPOSITION_SUBMITTED: ['disposition'],
  };
  for (const field of requiredByEvent[event.event] || []) {
    if (event[field] === undefined || event[field] === '') {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} is required for ${event.event}` });
    }
  }
});
const dialpadRecentCalls = new Map<string, number>();
const dialpadRateHits = new Map<string, number[]>();
const dialpadEventHits = new Map<string, number[]>();

function allowDialpadEvent(tenantId: string, userId: string, now: number) {
  const key = `${tenantId}:${userId}`;
  const recent = (dialpadEventHits.get(key) || []).filter((timestamp) => now - timestamp < 60_000);
  if (recent.length >= 60) {
    dialpadEventHits.set(key, recent);
    return false;
  }
  recent.push(now);
  dialpadEventHits.set(key, recent);
  return true;
}

function auditDialpadEvent(
  tenantId: string,
  userId: string,
  event: string,
  callId: string | null,
  leadId: string | null,
  fields: Prisma.InputJsonObject = {},
) {
  return prisma.auditLog.create({
    data: {
      tenantId,
      userId,
      leadId,
      action: event,
      objectType: callId ? 'CallDetail' : 'BizcallDialpad',
      objectId: callId,
      newValues: fields,
    },
  });
}

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
      const permissionConfigured = await EffectivePermissionService.isTelephonyPermissionConfigured();
      return res.json({
        success: true,
        ok: false,
        data: {
          active: false,
          permissionGranted: false,
          reasonCode: permissionConfigured ? 'NO_PERMISSION' : 'PERMISSION_UNAVAILABLE',
        },
      });
    }
    const settings = await prisma.telephonySetting.findUnique({ where: { tenantId: req.tenantId! } });
    if (!settings) {
      return res.json({ success: true, ok: false, data: { active: false, permissionGranted: true, reasonCode: 'NOT_CONFIGURED' } });
    }
    if (!settings.isActive) {
      return res.json({ success: true, ok: false, data: { active: false, permissionGranted: true, reasonCode: 'DISABLED' } });
    }
    if (!settings.encryptedCredentials) {
      return res.json({ success: true, ok: false, data: { active: false, permissionGranted: true, reasonCode: 'KEY_MISSING' } });
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
            permissionGranted: true,
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
        permissionGranted: true,
        reasonCode: 'ACTIVE',
        dialpadUrl,
        dialpadOrigin: new URL(dialpadUrl).origin,
        dialpadMode: settings?.dialpadMode || 'DOCKED',
        callMethod: settings?.callMethod || 'SERVER_API',
        theme: settings?.theme || 'CRM',
        defaultDockState: settings?.defaultDockState || 'COLLAPSED',
        maskNumbers: Boolean(settings?.maskNumbers),
        sendTenantIdInDial: settings?.sendTenantIdInDial ?? true,
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
  if (!parsed.success) {
    const manual = manualDialpadCallSchema.safeParse(req.body);
    if (!manual.success) {
      return res.status(400).json({ success: false, ok: false, code: 'INVALID_REQUEST', message: 'A valid lead or E.164 number is required.' });
    }
    if (!(await EffectivePermissionService.hasPermission(req.user!.id, 'TELEPHONY_CALL'))) {
      return res.status(403).json({ success: false, ok: false, code: 'NO_PERMISSION', message: 'Telephony permission is required.' });
    }
    try {
      const settings = await prisma.telephonySetting.findUnique({ where: { tenantId: req.tenantId! } });
      if (!settings?.isActive || !settings.encryptedCredentials) {
        return res.status(409).json({ success: false, ok: false, code: 'TELEPHONY_KEY_MISSING', message: 'Telephony is not active for this company.' });
      }
      const now = new Date();
      const call = await prisma.callDetail.create({
        data: {
          tenantId: req.tenantId!,
          leadId: null,
          name: `Dialpad manual call ${now.getTime()}`.slice(0, 255),
          callType: 'OUTBOUND',
          callTo: manual.data.number,
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
      await auditDialpadEvent(req.tenantId!, req.user!.id, 'DIALPAD_CALL_STARTED', call.id, null, {
        number: maskPhone(manual.data.number),
      });
      return res.status(201).json({ success: true, ok: true, data: { callDetailId: call.id } });
    } catch (error) {
      console.error('Manual dialpad call could not be recorded', error instanceof Error ? error.name : 'error');
      return res.status(500).json({ success: false, ok: false, code: 'CALL_START_FAILED', message: 'The call could not be recorded.' });
    }
  }
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
      await tx.auditLog.create({
        data: {
          tenantId: req.tenantId!,
          userId: req.user!.id,
          leadId: lead.id,
          action: 'DIALPAD_CALL_STARTED',
          objectType: 'CallDetail',
          objectId: created.id,
          newValues: { number: maskPhone(normalized.e164) },
        },
      });
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
  if (!allowDialpadEvent(req.tenantId!, req.user!.id, Date.now())) {
    return res.status(429).json({ success: false, ok: false, code: 'RATE_LIMITED', message: 'Too many dialpad events. Try again shortly.' });
  }
  if (!(await EffectivePermissionService.hasPermission(req.user!.id, 'TELEPHONY_CALL'))) {
    return res.status(403).json({ success: false, ok: false, code: 'NO_PERMISSION', message: 'Telephony permission is required.' });
  }
  try {
    const event = parsed.data;
    if (event.event === 'BIZCALL_AGENT_REGISTERED') {
      await auditDialpadEvent(req.tenantId!, req.user!.id, event.event, null, null, {
        name: event.name || '',
        extension: event.extension || '',
      });
      return res.json({ success: true, ok: true, data: { event: event.event } });
    }

    let lead: { id: string; tenantId: string; ownerId: string | null; creatorId: string } | null = null;
    if (event.leadId) {
      lead = await prisma.lead.findFirst({
        where: { id: event.leadId, tenantId: req.tenantId! },
        select: { id: true, tenantId: true, ownerId: true, creatorId: true },
      });
      if (!lead || !(await canAccessLead(req.user!, lead))) {
        return res.status(404).json({ success: false, ok: false, code: 'LEAD_NOT_FOUND', message: 'Lead not found.' });
      }
    }

    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const call = await prisma.$transaction(async (tx) => {
      let existing = event.callUuid
        ? await tx.callDetail.findFirst({
          where: {
            tenantId: req.tenantId!,
            createdById: req.user!.id,
            OR: [{ providerCallId: event.callUuid }, { callId: event.callUuid }],
            ...(lead ? { leadId: lead.id } : {}),
          },
        })
        : null;
      if (!existing) {
        existing = await tx.callDetail.findFirst({
          where: {
            tenantId: req.tenantId!,
            createdById: req.user!.id,
            source: 'dialpad',
            startAt: { gte: fiveMinutesAgo },
            status: { in: ['Initiated', 'Calling', 'Connected'] },
            ...(lead ? { leadId: lead.id } : { leadId: null, ...(event.number ? { callTo: event.number } : {}) }),
          },
          orderBy: { startAt: 'desc' },
        });
      }

      if (!existing && event.event === 'BIZCALL_CALL_STARTING' && !lead && event.number) {
        existing = await tx.callDetail.create({
          data: {
            tenantId: req.tenantId!,
            leadId: null,
            name: `Dialpad manual call ${now.getTime()}`.slice(0, 255),
            callType: 'OUTBOUND',
            callTo: event.number,
            status: 'Calling',
            startAt: now,
            endAt: now,
            duration: 0,
            createdById: req.user!.id,
            ownerId: req.user!.id,
            lastModifiedById: req.user!.id,
            source: 'dialpad',
            providerCallId: event.callUuid || null,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: req.tenantId!,
            userId: req.user!.id,
            action: 'DIALPAD_CALL_STARTED',
            objectType: 'CallDetail',
            objectId: existing.id,
            newValues: { number: maskPhone(event.number) },
          },
        });
      }
      if (!existing) return null;

      const terminal = ['Ended', 'Completed', 'NO_ANSWER', 'BUSY', 'VOICEMAIL', 'CANCELLED'].includes(existing.status);
      const update: Record<string, unknown> = { source: 'dialpad', lastModifiedById: req.user!.id };
      let shouldAudit = false;
      if (event.callUuid && existing.providerCallId !== event.callUuid) update.providerCallId = event.callUuid;
      if (event.number && !existing.callTo) update.callTo = event.number;

      if (event.event === 'BIZCALL_CALL_STARTING' && !terminal && existing.status === 'Initiated') {
        update.status = 'Calling';
        shouldAudit = true;
      } else if (event.event === 'BIZCALL_CALL_CONNECTED' && !terminal && existing.status !== 'Connected') {
        update.status = 'Connected';
        update.answeredAt = existing.answeredAt || now;
        shouldAudit = true;
      } else if (event.event === 'BIZCALL_CALL_ENDED' && !terminal) {
        update.status = 'Ended';
        update.endAt = now;
        if (event.duration !== undefined) update.duration = event.duration;
        shouldAudit = true;
      } else if (event.event === 'BIZCALL_DISPOSITION_SUBMITTED') {
        const dispositionChanged = event.disposition !== undefined && existing.disposition !== event.disposition;
        const notesChanged = event.notes !== undefined && existing.notes !== event.notes;
        if (dispositionChanged || notesChanged) {
          if (event.disposition !== undefined) update.disposition = event.disposition;
          if (event.notes !== undefined) update.notes = event.notes;
          shouldAudit = true;
        }
      }
      const updated = Object.keys(update).length > 2
        ? await tx.callDetail.update({ where: { id: existing.id }, data: update })
        : existing;

      if (shouldAudit) {
        const auditFields: Prisma.InputJsonObject = {
          number: maskPhone(String(updated.callTo || event.number || '')),
          ...(event.event === 'BIZCALL_CALL_ENDED' ? { duration: event.duration ?? updated.duration } : {}),
          ...(event.event === 'BIZCALL_DISPOSITION_SUBMITTED' ? { disposition: event.disposition || '' } : {}),
        };
        await tx.auditLog.create({
          data: {
            tenantId: req.tenantId!,
            userId: req.user!.id,
            leadId: updated.leadId,
            action: event.event,
            objectType: 'CallDetail',
            objectId: updated.id,
            newValues: auditFields,
          },
        });
      }
      if (
        event.event === 'BIZCALL_DISPOSITION_SUBMITTED'
        && lead
        && shouldAudit
      ) {
        await appendLeadProcessNote(tx, {
          tenantId: req.tenantId!,
          leadId: lead.id,
          userId: req.user!.id,
          content: [
            `Call disposition saved: ${event.disposition || 'Unspecified'}`,
            event.notes ? `Notes: ${event.notes}` : null,
          ].filter(Boolean).join('\n'),
        });
      }
      if (event.event === 'BIZCALL_CALL_STARTING' && shouldAudit && lead) {
        await applyCallLogStatusRule(lead.id, tx, {
          tenantId: req.tenantId!,
          userId: req.user!.id,
          callLogId: updated.id,
        });
      }
      return updated;
    });

    if (!call) {
      return res.status(404).json({ success: false, ok: false, code: 'CALL_NOT_FOUND', message: 'No matching dialpad call was found.' });
    }
    return res.json({ success: true, ok: true, data: { callDetailId: call.id, event: event.event, leadId: call.leadId } });
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
