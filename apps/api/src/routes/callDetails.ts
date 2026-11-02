import { Router, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@dct-crm/db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/authorization';
import { canAccessLeadId } from '../services/recordAccess';
import { applyCallLogStatusRule } from '../services/callLogStatus';
import { followUpAccessWhere } from '../services/followUpAccess';
import { tagLeadFollowUpEvents } from '../services/leadEventTagging';
import { appendLeadProcessNote } from '../services/leadNotes';
import { maskPhone } from '../services/clickToCall';

const router = Router();
router.use(authenticate);

export const callDetailSchema = z.object({
  leadId: z.string().min(1),
  caseId: z.string().min(1).optional(),
  ownerId: z.string().min(1).optional(),
  callType: z.enum(['INBOUND', 'OUTBOUND']),
  callFrom: z.string().trim().max(255).optional(),
  callTo: z.string().trim().max(50).optional(),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  executiveContactNo: z.string().trim().max(50).optional(),
  landingNumber: z.string().trim().max(255).optional(),
  parentId: z.string().trim().max(100).optional(),
  parentUrl: z.string().trim().max(255).optional(),
  recordingFile: z.string().trim().max(255).url().optional(),
  status: z.enum(['COMPLETED', 'NO_ANSWER', 'BUSY', 'VOICEMAIL', 'CANCELLED']).default('COMPLETED'),
  notes: z.string().trim().max(5000).optional(),
});
export const callDetailUpdateSchema = callDetailSchema.omit({ leadId: true }).partial();

router.get('/', authorize('Activity', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const parsedLeadId = z.string().min(1).optional().safeParse(req.query.leadId);
    if (!parsedLeadId.success) return res.status(400).json({ success: false, error: 'A valid leadId is required' });
    const leadId = parsedLeadId.data;
    if (leadId) {
      const lead = await prisma.lead.findFirst({
        where: { id: leadId, tenantId: req.tenantId! },
        select: { id: true },
      });
      if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
      if (!(await canAccessLeadId(req.user!, leadId))) {
        return res.status(403).json({ success: false, error: 'You do not have access to this lead' });
      }
    }

    const data = await prisma.callDetail.findMany({
      where: leadId
        ? { tenantId: req.tenantId!, leadId }
        : {
          tenantId: req.tenantId!,
          leadId: null,
          ...(!req.user?.isAdmin && !req.user?.isSuperAdmin ? { createdById: req.user!.id } : {}),
        },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        lastModifiedBy: { select: { id: true, firstName: true, lastName: true } },
        owner: { select: { id: true, firstName: true, lastName: true } },
        case: { select: { id: true, firstName: true, lastName: true, leadNumber: true } },
        lead: { select: { id: true, firstName: true, lastName: true, leadNumber: true } },
      },
      orderBy: [{ startAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    const maskNumbers = !leadId || (!req.user?.isAdmin && !req.user?.isSuperAdmin &&
      Boolean((await prisma.telephonySetting.findUnique({ where: { tenantId: req.tenantId! }, select: { maskNumbers: true } }))?.maskNumbers));
    res.json({
      success: true,
      data: maskNumbers
        ? data.map((call) => ({ ...call, callTo: call.callTo ? maskPhone(call.callTo) : null }))
        : data,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'A valid leadId is required' });
    }
    console.error('Get call details error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch call details' });
  }
});

router.get('/:id', authorize('Activity', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const call = await prisma.callDetail.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId! },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        lastModifiedBy: { select: { id: true, firstName: true, lastName: true } },
        owner: { select: { id: true, firstName: true, lastName: true } },
        case: { select: { id: true, firstName: true, lastName: true, leadNumber: true } },
        lead: { select: { id: true, firstName: true, lastName: true, leadNumber: true } },
      },
    });
    if (!call) return res.status(404).json({ success: false, error: 'Call details not found' });
    const canReadUnlinkedCall = call.leadId === null
      && (call.createdById === req.user!.id || req.user?.isAdmin || req.user?.isSuperAdmin);
    if (call.leadId ? !(await canAccessLeadId(req.user!, call.leadId)) : !canReadUnlinkedCall) {
      return res.status(403).json({ success: false, error: 'You do not have access to this call' });
    }
    const maskNumbers = call.leadId === null || (!req.user?.isAdmin && !req.user?.isSuperAdmin &&
      Boolean((await prisma.telephonySetting.findUnique({ where: { tenantId: req.tenantId! }, select: { maskNumbers: true } }))?.maskNumbers));
    res.json({
      success: true,
      data: maskNumbers && call.callTo ? { ...call, callTo: maskPhone(call.callTo) } : call,
    });
  } catch (error) {
    console.error('Get call details error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch call details' });
  }
});

router.post('/', authorize('Activity', 'create'), async (req: AuthRequest, res: Response) => {
  try {
    const data = callDetailSchema.parse(req.body);
    const startAt = new Date(data.startAt);
    const endAt = new Date(data.endAt);
    if (endAt < startAt) {
      return res.status(400).json({ success: false, error: 'End time must be after start time' });
    }
    const lead = await prisma.lead.findFirst({
      where: { id: data.leadId, tenantId: req.tenantId! },
      select: { id: true },
    });
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    if (!(await canAccessLeadId(req.user!, data.leadId))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this lead' });
    }

    const [owner, caseLead] = await Promise.all([
      data.ownerId
        ? prisma.user.findFirst({ where: { id: data.ownerId, tenantId: req.tenantId!, isActive: true }, select: { id: true } })
        : Promise.resolve({ id: req.user!.id }),
      data.caseId
        ? prisma.lead.findFirst({ where: { id: data.caseId, tenantId: req.tenantId! }, select: { id: true } })
        : Promise.resolve(null),
    ]);
    if (!owner) return res.status(400).json({ success: false, error: 'Owner must be an active user in this company' });
    if (data.caseId && (!caseLead || !(await canAccessLeadId(req.user!, data.caseId)))) {
      return res.status(400).json({ success: false, error: 'Case must reference a lead you can access' });
    }
    const call = await prisma.$transaction(async (tx) => {
      const callId = randomUUID();
      const created = await tx.callDetail.create({
        data: {
          name: `CALL-${callId.slice(0, 12).toUpperCase()}`,
          callId,
          tenantId: req.tenantId!,
          leadId: data.leadId,
          caseId: data.caseId,
          ownerId: owner.id,
          createdById: req.user!.id,
          lastModifiedById: req.user!.id,
          callType: data.callType,
          callFrom: data.callFrom || null,
          callTo: data.callTo || null,
          startAt,
          endAt,
          duration: Math.round((endAt.getTime() - startAt.getTime()) / 1000),
          executiveContactNo: data.executiveContactNo || null,
          landingNumber: data.landingNumber || null,
          parentId: data.parentId || data.leadId,
          parentUrl: data.parentUrl || null,
          recordingFile: data.recordingFile || null,
          status: data.status,
          notes: data.notes || null,
        },
        include: {
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          lastModifiedBy: { select: { id: true, firstName: true, lastName: true } },
          owner: { select: { id: true, firstName: true, lastName: true } },
          case: { select: { id: true, firstName: true, lastName: true, leadNumber: true } },
          lead: { select: { id: true, firstName: true, lastName: true, leadNumber: true } },
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: req.tenantId!,
          userId: req.user!.id,
          leadId: data.leadId,
          action: 'CREATE',
          objectType: 'CallDetail',
          objectId: created.id,
          newValues: {
            name: created.name,
            callId: created.callId,
            callFrom: created.callFrom,
            callTo: created.callTo,
            callType: created.callType,
            duration: created.duration,
            startAt: created.startAt.toISOString(),
            endAt: created.endAt.toISOString(),
            status: created.status,
            parentUrl: created.parentUrl,
            recordingFile: created.recordingFile,
            notes: created.notes,
          },
        },
      });
      const callDuration = created.duration ?? Math.round((endAt.getTime() - startAt.getTime()) / 1000);
      await appendLeadProcessNote(tx, {
        tenantId: req.tenantId!,
        leadId: data.leadId,
        userId: req.user!.id,
        content: [
          `${data.callType === 'INBOUND' ? 'Inbound' : 'Outbound'} call logged: ${created.name || 'Call'}`,
          `Status: ${(created.status || data.status).replace(/_/g, ' ')}`,
          `Duration: ${Math.floor(callDuration / 60)}m ${callDuration % 60}s`,
          created.notes ? `Notes: ${created.notes}` : null,
        ].filter(Boolean).join('\n'),
      });
      const followUp = await tx.followUp.findFirst({
        where: {
          ...followUpAccessWhere(req.user!, req.tenantId!),
          leadId: data.leadId,
          isCompleted: false,
          isMissed: false,
        },
        orderBy: { dueDate: 'asc' },
      });
      if (followUp) {
        await tx.followUp.update({
          where: { id: followUp.id },
          data: { isCompleted: true, completedAt: new Date(), isMissed: false, missedAt: null },
        });
        await appendLeadProcessNote(tx, {
          tenantId: req.tenantId!,
          leadId: data.leadId,
          userId: req.user!.id,
          content: `Follow-up completed during call: ${followUp.title}`,
        });
        await tx.auditLog.create({
          data: {
            tenantId: req.tenantId!,
            userId: req.user!.id,
            leadId: data.leadId,
            action: 'STATUS_CHANGE',
            objectType: 'FollowUp',
            objectId: followUp.id,
            oldValues: { isCompleted: false, isMissed: followUp.isMissed },
            newValues: { isCompleted: true, isMissed: false, source: 'CALL_LOG' },
          },
        });
        await tagLeadFollowUpEvents(tx, req.tenantId!, data.leadId);
      }
      const leadStatus = await applyCallLogStatusRule(data.leadId, tx, {
        tenantId: req.tenantId!,
        userId: req.user!.id,
        callLogId: created.id,
      });
      return { ...created, leadStatus: leadStatus.status, leadStatusChanged: leadStatus.changed };
    });

    res.status(201).json({ success: true, data: call });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.issues[0]?.message || 'Invalid call details' });
    }
    console.error('Create call details error:', error);
    res.status(500).json({ success: false, error: 'Failed to create call details' });
  }
});

router.put('/:id', authorize('Activity', 'edit'), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.callDetail.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId! },
    });
    if (!existing) return res.status(404).json({ success: false, error: 'Call details not found' });
    const canEditUnlinkedCall = existing.leadId === null
      && (existing.createdById === req.user!.id || req.user?.isAdmin || req.user?.isSuperAdmin);
    if (existing.leadId ? !(await canAccessLeadId(req.user!, existing.leadId)) : !canEditUnlinkedCall) {
      return res.status(403).json({ success: false, error: 'You do not have access to this call' });
    }

    const data = callDetailUpdateSchema.parse(req.body);
    const startAt = data.startAt ? new Date(data.startAt) : existing.startAt;
    const endAt = data.endAt ? new Date(data.endAt) : existing.endAt;
    if (endAt < startAt) {
      return res.status(400).json({ success: false, error: 'End time must be after start time' });
    }
    const [owner, caseLead] = await Promise.all([
      data.ownerId
        ? prisma.user.findFirst({ where: { id: data.ownerId, tenantId: req.tenantId!, isActive: true }, select: { id: true } })
        : Promise.resolve(undefined),
      data.caseId
        ? prisma.lead.findFirst({ where: { id: data.caseId, tenantId: req.tenantId! }, select: { id: true } })
        : Promise.resolve(undefined),
    ]);
    if (data.ownerId && !owner) {
      return res.status(400).json({ success: false, error: 'Owner must be an active user in this company' });
    }
    if (data.caseId && !caseLead) {
      return res.status(400).json({ success: false, error: 'Case must reference a lead in this company' });
    }
    if (data.caseId && !(await canAccessLeadId(req.user!, data.caseId))) {
      return res.status(400).json({ success: false, error: 'Case must reference a lead you can access' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const call = await tx.callDetail.update({
        where: { id: existing.id },
        data: {
          ...(data.caseId !== undefined ? { caseId: data.caseId } : {}),
          ...(data.ownerId !== undefined ? { ownerId: data.ownerId } : {}),
          ...(data.callType !== undefined ? { callType: data.callType } : {}),
          ...(data.callFrom !== undefined ? { callFrom: data.callFrom || null } : {}),
          ...(data.callTo !== undefined ? { callTo: data.callTo || null } : {}),
          ...(data.startAt !== undefined ? { startAt } : {}),
          ...(data.endAt !== undefined ? { endAt } : {}),
          ...(data.startAt !== undefined || data.endAt !== undefined
            ? { duration: Math.round((endAt.getTime() - startAt.getTime()) / 1000) }
            : {}),
          ...(data.executiveContactNo !== undefined ? { executiveContactNo: data.executiveContactNo || null } : {}),
          ...(data.landingNumber !== undefined ? { landingNumber: data.landingNumber || null } : {}),
          ...(data.parentId !== undefined ? { parentId: data.parentId || null } : {}),
          ...(data.parentUrl !== undefined ? { parentUrl: data.parentUrl || null } : {}),
          ...(data.recordingFile !== undefined ? { recordingFile: data.recordingFile || null } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
          lastModifiedById: req.user!.id,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: req.tenantId!,
          userId: req.user!.id,
          leadId: existing.leadId,
          action: 'UPDATE',
          objectType: 'CallDetail',
          objectId: existing.id,
          oldValues: {
            callType: existing.callType,
            startAt: existing.startAt.toISOString(),
            endAt: existing.endAt.toISOString(),
            status: existing.status,
            notes: existing.notes,
            ownerId: existing.ownerId,
            caseId: existing.caseId,
          },
          newValues: {
            callType: call.callType,
            startAt: call.startAt.toISOString(),
            endAt: call.endAt.toISOString(),
            status: call.status,
            notes: call.notes,
            ownerId: call.ownerId,
            caseId: call.caseId,
          },
        },
      });
      if (existing.leadId) {
        await appendLeadProcessNote(tx, {
          tenantId: req.tenantId!,
          leadId: existing.leadId,
          userId: req.user!.id,
          content: `Call details updated: ${call.callType === 'INBOUND' ? 'Inbound' : 'Outbound'} call · ${call.status.replace(/_/g, ' ')}${call.notes ? ` · ${call.notes}` : ''}`,
        });
      }
      return call;
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.issues[0]?.message || 'Invalid call details' });
    }
    console.error('Update call details error:', error);
    res.status(500).json({ success: false, error: 'Failed to update call details' });
  }
});

router.delete('/:id', authorize('Activity', 'delete'), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.callDetail.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId! },
    });
    if (!existing) return res.status(404).json({ success: false, error: 'Call details not found' });
    const canDeleteUnlinkedCall = existing.leadId === null
      && (existing.createdById === req.user!.id || req.user?.isAdmin || req.user?.isSuperAdmin);
    if (existing.leadId ? !(await canAccessLeadId(req.user!, existing.leadId)) : !canDeleteUnlinkedCall) {
      return res.status(403).json({ success: false, error: 'You do not have access to this call' });
    }
    await prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          tenantId: req.tenantId!,
          userId: req.user!.id,
          leadId: existing.leadId,
          action: 'DELETE',
          objectType: 'CallDetail',
          objectId: existing.id,
          oldValues: {
            callType: existing.callType,
            startAt: existing.startAt.toISOString(),
            endAt: existing.endAt.toISOString(),
            status: existing.status,
            notes: existing.notes,
            ownerId: existing.ownerId,
            caseId: existing.caseId,
          },
        },
      });
      if (existing.leadId) {
        await appendLeadProcessNote(tx, {
          tenantId: req.tenantId!,
          leadId: existing.leadId,
          userId: req.user!.id,
          content: `Call details deleted: ${existing.callType === 'INBOUND' ? 'Inbound' : 'Outbound'} call ${existing.name}`,
        });
      }
      await tx.callDetail.delete({ where: { id: existing.id } });
    });
    res.json({ success: true, message: 'Call details deleted successfully' });
  } catch (error) {
    console.error('Delete call details error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete call details' });
  }
});

export default router;
