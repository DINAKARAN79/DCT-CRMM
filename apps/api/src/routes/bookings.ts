import fs from 'fs';
import path from 'path';
import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@dct-crm/db';
import { renderQuotationPdf } from '../services/quotationPdf';
import { authenticate, AuthRequest } from '../middleware/auth';
import { listOrderBy, listViewConstraint, mergeListWhere } from '../services/listViewService';
import { authorize, authorizeEffectivePermission } from '../middleware/authorization';
import { auditLog } from '../middleware/audit';
import { canAccessLead } from '../services/recordAccess';
import { withImpersonatorNames } from '../services/impersonation';
import { BOOKING_DETAIL_FIELDS, INDIAN_STATES, ORGANIZATION_TYPES, PAN_PATTERN } from '@dct-crm/shared';

const router = Router();

const optionalText = z.string().max(500).optional().nullable();
const photoUrl = z.union([
  z.string().regex(/^data:image\/(jpeg|png);base64,/).max(1_500_000),
  z.literal(''),
]).optional().nullable();

const firstApplicantSchema = z.object({
  salutation: z.string().trim().min(1, 'Salutation is required').max(30),
  name: z.string().trim().min(1, 'Full name is required').max(200),
  photoUrl,
  dateOfBirth: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    }, 'Enter a valid date of birth'),
  relationType: optionalText,
  relationshipName: optionalText,
  nationality: z.string().trim().min(1, 'Nationality is required').max(100),
  aadhaarNumber: z.string().trim().min(4, 'Enter a valid Aadhaar number').max(30),
  panNumber: z.string().trim().regex(PAN_PATTERN, 'Enter a valid PAN number'),
  email: z.string().email().max(254),
  mobileNumber: z.string().min(7).max(30),
  alternateNumber: z.string().max(30).optional().nullable(),
  maritalStatus: z.string().trim().min(1, 'Marital status is required').max(40),
  state: z.string().trim().refine(
    (value) => (INDIAN_STATES as readonly string[]).includes(value),
    'Select a state',
  ),
  district: z.string().max(100).optional().nullable(),
  correspondingAddress: optionalText,
  permanentAddress: z.string().trim().min(1, 'Permanent address is required').max(1000),
});

const additionalApplicantSchema = firstApplicantSchema.extend({
  sameAddress: z.boolean().optional(),
});

const secondApplicantSchema = z.object({
  salutation: z.string().max(30).optional().nullable(),
  name: z.string().max(200).optional().nullable(),
  photoUrl,
  dateOfBirth: z.string().max(20).optional().nullable(),
  relationType: optionalText,
  relationshipName: optionalText,
  nationality: z.string().max(100).optional().nullable(),
  aadhaarNumber: z.string().max(30).optional().nullable(),
  panNumber: z.string().max(20).optional().nullable(),
  email: z.string().max(254).optional().nullable(),
  mobileNumber: z.string().max(30).optional().nullable(),
  alternateNumber: z.string().max(30).optional().nullable(),
  maritalStatus: z.string().max(40).optional().nullable(),
  state: z.string().max(100).optional().nullable(),
  district: z.string().max(100).optional().nullable(),
  correspondingAddress: optionalText,
  permanentAddress: optionalText,
  sameAddress: z.boolean().optional(),
}).refine((applicant) =>
  !Object.entries(applicant).some(([key, value]) =>
    key !== 'sameAddress' && typeof value === 'string' && value.trim().length > 0
  ) || !!applicant.name?.trim(),
{ message: 'Enter the second applicant name or clear the optional details' }).optional().nullable();

export const bookingSchema = z.object({
  bookingAmount: z.number().finite().min(0),
  firstApplicant: firstApplicantSchema,
  secondApplicant: secondApplicantSchema,
  profession: z.object({
    organizationType: z.enum(ORGANIZATION_TYPES, { errorMap: () => ({ message: 'Select an organization type' }) }),
    industry: z.string().trim().min(1, 'Industry is required').max(100),
    additionalApplicants: z.array(additionalApplicantSchema).max(2).optional(),
  }),
  referredBy: z.enum(['Customer', 'Employee']).optional().nullable(),
});

const welcomeCallSchema = z.object({
  notes: z.string().trim().max(1000).optional(),
});

const bookingDetailsSchema = z.object({
  details: z.record(z.string(), z.union([
    z.string().max(1000),
    z.number().finite(),
    z.boolean(),
    z.null(),
  ])),
}).superRefine(({ details }, context) => {
  const fieldByName = new Map(BOOKING_DETAIL_FIELDS.map((field) => [field.name, field]));
  for (const [name, value] of Object.entries(details)) {
    const field = fieldByName.get(name);
    if (!field || field.editable === false) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['details', name], message: 'Unknown or read-only booking field' });
      continue;
    }
    const validType = value === null || (field.fieldType === 'checkbox'
      ? typeof value === 'boolean'
      : field.fieldType === 'number' || field.fieldType === 'currency'
        ? typeof value === 'number'
        : typeof value === 'string');
    if (!validType) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['details', name], message: 'Invalid booking field value' });
    }
  }
});

const PRIVATE_BOOKING_AUDIT_FIELD = /applicant|witness|name|email|phone|mobile|address|aadhaar|aadhar|pan|photo|account|bank.?executive|document|customer|owner|manager|user|notes?|comments?|reason|whatsapp/i;

const asJsonObject = (value: Prisma.JsonValue): Record<string, Prisma.JsonValue> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};

class UnitUnavailableError extends Error {}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

const requireAdminOrCrm = (req: AuthRequest, res: Response, next: () => void) => {
  const isCrm = /^crm(?:\s|$)/i.test(req.user?.profileName?.trim() || '');
  if (req.user?.isSuperAdmin || req.user?.isAdmin || isCrm) return next();
  return res.status(403).json({ success: false, error: 'Admin or CRM access is required' });
};

router.get(
  '/',
  authenticate,
  requireAdminOrCrm,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantId } = req.user!;
      const where = { tenantId };
      const viewConstraint = await listViewConstraint(req, 'BOOKING');
      if (!viewConstraint.ok) return res.status(viewConstraint.status).json({ success: false, error: viewConstraint.error });
      mergeListWhere(where, viewConstraint.where);
      const sorted = listOrderBy('BOOKING', req.query.sortBy, req.query.sortOrder || 'desc');
      if (!sorted.ok) return res.status(400).json({ success: false, error: sorted.error });
      const bookings = await prisma.booking.findMany({
        where,
        include: {
          lead: { select: { id: true, leadNumber: true, firstName: true, lastName: true, owner: { select: { id: true, firstName: true, lastName: true } } } },
          quotation: true,
          project: { select: { id: true, name: true, address: true, city: true } },
          unit: { select: { id: true, number: true, type: true, area: true, status: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          owner: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: (sorted.orderBy || { createdAt: 'desc' }) as { createdAt: 'desc' },
        take: 500,
      });
      return res.json({ success: true, data: bookings });
    } catch (error) {
      console.error('Failed to fetch bookings:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch bookings' });
    }
  },
);

const STAGE_LABELS: Record<string, string> = {
  NEW_BOOKING: 'New Booking',
  WELCOME_CALL: 'Welcome Call',
  WELCOME_MAIL_RECEIPT_SENT: 'Welcome Mail & Receipt Sent',
  PARENT_DOCUMENT_SENT: 'Parent Document Sent',
  QUERIES: 'Queries',
  CANCELLED: 'Cancelled',
};

const logBookingActivity = async (
  tenantId: string,
  bookingId: string,
  userId: string,
  subject: string,
  description: string,
) => {
  try {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { leadId: true } });
    if (!booking) return;
    await prisma.activity.create({
      data: { tenantId, bookingId, leadId: booking.leadId, userId, type: 'SYSTEM', subject, description, status: 'COMPLETED', completedAt: new Date() },
    });
  } catch (error) {
    console.error('Failed to record booking activity:', error);
  }
};

const BOOKING_STAGES = [
  'NEW_BOOKING',
  'WELCOME_CALL',
  'WELCOME_MAIL_RECEIPT_SENT',
  'PARENT_DOCUMENT_SENT',
  'QUERIES',
  'CANCELLED',
] as const;

const stageSchema = z.object({ stage: z.enum(BOOKING_STAGES).refine((value) => value !== 'CANCELLED', 'Cancellation requires MIS approval') });
const cancelRequestSchema = z.object({ notes: z.string().trim().min(3).max(1000) });
const cancelReviewSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().trim().max(1000).optional() });

const requireMisReviewer = (req: AuthRequest, res: Response, next: () => void) => {
  const isMis = /^mis(?:\s|$)/i.test(req.user?.profileName?.trim() || '');
  if (req.user?.isSuperAdmin || req.user?.isAdmin || isMis) return next();
  return res.status(403).json({ success: false, error: 'MIS profile access is required' });
};

router.get(
  '/cancellation-requests',
  authenticate,
  requireMisReviewer,
  async (req: AuthRequest, res: Response) => {
    try {
      const requests = await prisma.booking.findMany({
        where: { tenantId: req.user!.tenantId, cancellationStatus: 'PENDING' },
        include: {
          lead: { select: { id: true, leadNumber: true, firstName: true, lastName: true } },
          project: { select: { id: true, name: true } },
          unit: { select: { id: true, number: true } },
          quotation: { select: { customerName: true, totalPrice: true } },
        },
        orderBy: { cancellationRequestedAt: 'asc' },
        take: 200,
      });
      return res.json({ success: true, data: requests });
    } catch (error) {
      console.error('Failed to fetch cancellation requests:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch cancellation requests' });
    }
  },
);

router.post(
  '/:bookingId/cancel-request',
  authenticate,
  requireAdminOrCrm,
  async (req: AuthRequest, res: Response) => {
    try {
      const { notes } = cancelRequestSchema.parse(req.body);
      const { tenantId, id: userId } = req.user!;
      const updated = await prisma.booking.updateMany({
        where: {
          id: req.params.bookingId,
          tenantId,
          status: { not: 'CANCELLED' },
          OR: [{ cancellationStatus: null }, { cancellationStatus: 'REJECTED' }],
        },
        data: {
          cancellationStatus: 'PENDING',
          cancellationReason: notes,
          cancellationRequestedById: userId,
          cancellationRequestedAt: new Date(),
          cancellationReviewedById: null,
          cancellationReviewedAt: null,
          cancellationReviewNote: null,
        },
      });
      if (updated.count !== 1) {
        return res.status(409).json({ success: false, error: 'Booking is already cancelled or has a pending cancellation request' });
      }
      await auditLog(tenantId, userId, 'BOOKING_CANCELLATION_REQUESTED', 'Booking', req.params.bookingId, undefined, {
        cancellationStatus: 'PENDING',
        cancellationReason: notes,
      }, req.ip);
      await logBookingActivity(tenantId, req.params.bookingId, userId, 'Booking cancellation requested', `Sent to MIS team for verification. Notes: ${notes}`);
      return res.json({ success: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Cancellation notes are required' });
      }
      console.error('Failed to request cancellation:', error);
      return res.status(500).json({ success: false, error: 'Failed to request cancellation' });
    }
  },
);

router.post(
  '/:bookingId/cancellation-review',
  authenticate,
  requireMisReviewer,
  async (req: AuthRequest, res: Response) => {
    try {
      const { decision, note } = cancelReviewSchema.parse(req.body);
      const { tenantId, id: userId } = req.user!;
      const approve = decision === 'APPROVE';
      await prisma.$transaction(async (tx) => {
        const booking = await tx.booking.findFirst({
          where: { id: req.params.bookingId, tenantId, cancellationStatus: 'PENDING' },
          select: { id: true, unitId: true },
        });
        if (!booking) throw new Error('NO_PENDING_REQUEST');
        const claimed = await tx.booking.updateMany({
          where: { id: booking.id, tenantId, cancellationStatus: 'PENDING' },
          data: {
            cancellationStatus: approve ? 'APPROVED' : 'REJECTED',
            cancellationReviewedById: userId,
            cancellationReviewedAt: new Date(),
            cancellationReviewNote: note || null,
            ...(approve ? { status: 'CANCELLED', bookingStage: 'CANCELLED' } : {}),
          },
        });
        if (claimed.count !== 1) throw new Error('NO_PENDING_REQUEST');
        if (approve) {
          await tx.unit.updateMany({
            where: { id: booking.unitId, tenantId, status: { in: ['RESERVED', 'BOOKED'] } },
            data: { status: 'AVAILABLE' },
          });
        }
      });
      await auditLog(
        tenantId,
        userId,
        approve ? 'BOOKING_CANCELLATION_APPROVED' : 'BOOKING_CANCELLATION_REJECTED',
        'Booking',
        req.params.bookingId,
        { cancellationStatus: 'PENDING' },
        { cancellationStatus: approve ? 'APPROVED' : 'REJECTED', reviewNote: note || null },
        req.ip,
      );
      await logBookingActivity(
        tenantId, req.params.bookingId, userId,
        approve ? 'Booking cancelled by MIS' : 'Booking cancellation rejected by MIS',
        approve ? 'MIS verified the cancellation. Booking cancelled and the unit marked Available.' : `MIS rejected the cancellation request.${note ? ` Note: ${note}` : ''}`,
      );
      return res.json({ success: true });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, error: 'Invalid review decision' });
      if (error instanceof Error && error.message === 'NO_PENDING_REQUEST') {
        return res.status(409).json({ success: false, error: 'No pending cancellation request for this booking' });
      }
      console.error('Failed to review cancellation:', error);
      return res.status(500).json({ success: false, error: 'Failed to review cancellation' });
    }
  },
);

router.get(
  '/:bookingId/activity-history',
  authenticate,
  requireAdminOrCrm,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantId } = req.user!;
      const booking = await prisma.booking.findFirst({
        where: { id: req.params.bookingId, tenantId },
        select: { id: true },
      });
      if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

      const page = Number(req.query.page ?? 1);
      const limit = Number(req.query.limit ?? 100);
      if (!Number.isInteger(page) || page < 1 || page > 100 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        return res.status(400).json({ success: false, error: 'Invalid activity history page or limit' });
      }

      const take = page * limit;
      const [activities, followUps, activityCount, followUpCount] = await Promise.all([
        prisma.activity.findMany({
          where: { tenantId, bookingId: booking.id },
          include: { user: { select: { id: true, firstName: true, lastName: true } } },
          take,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
        prisma.followUp.findMany({
          where: { tenantId, bookingId: booking.id },
          include: { owner: { select: { id: true, firstName: true, lastName: true } } },
          take,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
        prisma.activity.count({ where: { tenantId, bookingId: booking.id } }),
        prisma.followUp.count({ where: { tenantId, bookingId: booking.id } }),
      ]);
      const followUpActivities = followUps.map((followUp) => ({
        id: followUp.id,
        type: 'FOLLOW_UP',
        subject: followUp.title,
        description: followUp.description,
        notes: followUp.comments,
        dueDate: followUp.dueDate,
        status: followUp.status,
        createdAt: followUp.createdAt,
        user: followUp.owner,
      }));
      const data = [...activities, ...followUpActivities]
        .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())
        .slice(0, take);
      return res.json({
        success: true,
        data,
        pagination: { page, limit, total: activityCount + followUpCount, totalPages: Math.ceil((activityCount + followUpCount) / limit) },
      });
    } catch (error) {
      console.error('Failed to fetch booking activity history:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch booking activity history' });
    }
  },
);

router.get(
  '/:bookingId/audit-history',
  authenticate,
  requireAdminOrCrm,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantId } = req.user!;
      const booking = await prisma.booking.findFirst({
        where: { id: req.params.bookingId, tenantId },
        select: { id: true },
      });
      if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

      const page = Number(req.query.page ?? 1);
      const limit = Number(req.query.limit ?? 100);
      if (!Number.isInteger(page) || page < 1 || page > 100 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        return res.status(400).json({ success: false, error: 'Invalid audit history page or limit' });
      }
      const where = { tenantId, objectType: 'Booking', objectId: booking.id };
      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.auditLog.count({ where }),
      ]);
      return res.json({
        success: true,
        data: await withImpersonatorNames(logs),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (error) {
      console.error('Failed to fetch booking audit history:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch booking audit history' });
    }
  },
);

router.get(
  '/:bookingId',
  authenticate,
  requireAdminOrCrm,
  async (req: AuthRequest, res: Response) => {
    try {
      const booking = await prisma.booking.findFirst({
        where: { id: req.params.bookingId, tenantId: req.user!.tenantId },
        include: {
          lead: { select: { id: true, leadNumber: true, firstName: true, lastName: true, owner: { select: { id: true, firstName: true, lastName: true } } } },
          quotation: true,
          project: { select: { id: true, name: true, address: true, city: true } },
          unit: { select: { id: true, number: true, type: true, area: true, status: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          owner: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });
      return res.json({ success: true, data: booking });
    } catch (error) {
      console.error('Failed to fetch booking:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch booking' });
    }
  },
);

router.patch(
  '/:bookingId/details',
  authenticate,
  requireAdminOrCrm,
  async (req: AuthRequest, res: Response) => {
    try {
      const { details: changedDetails } = bookingDetailsSchema.parse(req.body);
      const { tenantId, id: userId } = req.user!;
      const current = await prisma.booking.findFirst({
        where: { id: req.params.bookingId, tenantId },
        select: { id: true, details: true },
      });
      if (!current) return res.status(404).json({ success: false, error: 'Booking not found' });

      const previousDetails = asJsonObject(current.details);
      const changedFields = Object.entries(changedDetails)
        .filter(([field, value]) => JSON.stringify(previousDetails[field] ?? null) !== JSON.stringify(value))
        .map(([field, newValue]) => {
          const fieldDefinition = BOOKING_DETAIL_FIELDS.find((entry) => entry.name === field);
          const oldValue = previousDetails[field];
          const isPrivate = PRIVATE_BOOKING_AUDIT_FIELD.test(field);
          return {
            field,
            label: fieldDefinition?.label || field,
            oldValue: isPrivate ? 'Hidden for privacy' : oldValue ?? null,
            newValue: isPrivate ? 'Hidden for privacy' : newValue,
          };
        });
      const details = { ...previousDetails, ...changedDetails } as Prisma.InputJsonObject;
      const booking = await prisma.booking.update({
        where: { id: current.id },
        data: { details },
        select: { id: true, details: true, updatedAt: true },
      });
      if (changedFields.length) {
        await auditLog(
          tenantId,
          userId,
          'BOOKING_DETAILS_UPDATED',
          'Booking',
          current.id,
          undefined,
          { changes: changedFields },
          req.ip,
        );
      }
      return res.json({ success: true, data: booking });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Invalid booking details' });
      }
      console.error('Failed to update booking details:', error);
      return res.status(500).json({ success: false, error: 'Failed to update booking details' });
    }
  },
);

router.patch(
  '/:bookingId/stage',
  authenticate,
  requireAdminOrCrm,
  async (req: AuthRequest, res: Response) => {
    try {
      const { stage } = stageSchema.parse(req.body);
      const { tenantId, id: userId } = req.user!;
      const current = await prisma.booking.findFirst({
        where: { id: req.params.bookingId, tenantId },
        select: { id: true, unitId: true, status: true, bookingStage: true },
      });
      if (!current) return res.status(404).json({ success: false, error: 'Booking not found' });
      if (current.status === 'CANCELLED' || current.bookingStage === 'CANCELLED') {
        return res.status(409).json({ success: false, error: 'A cancelled booking cannot be changed' });
      }

      const booking = await prisma.$transaction(async (tx) => {
        const updated = await tx.booking.update({
          where: { id: current.id },
          data: { bookingStage: stage },
          select: { id: true, bookingNumber: true, status: true, bookingStage: true },
        });
        return updated;
      });

      await auditLog(tenantId, userId, 'BOOKING_STAGE_CHANGED', 'Booking', current.id, { bookingStage: current.bookingStage }, { bookingStage: stage }, req.ip);
      await logBookingActivity(
        tenantId, current.id, userId,
        `Booking status updated - ${booking.bookingNumber}`,
        `Booking status changed from ${STAGE_LABELS[current.bookingStage]} to ${STAGE_LABELS[stage]}.`,
      );
      return res.json({ success: true, data: booking });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Invalid booking status' });
      }
      console.error('Failed to update booking stage:', error);
      return res.status(500).json({ success: false, error: 'Failed to update booking status' });
    }
  },
);

router.get(
  '/lead/:leadId',
  authenticate,
  authorize('Lead', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantId } = req.user!;
      const lead = await prisma.lead.findFirst({
        where: { id: req.params.leadId, tenantId },
        select: { id: true, tenantId: true, ownerId: true, creatorId: true },
      });
      if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
      if (!(await canAccessLead(req.user!, lead))) {
        return res.status(403).json({ success: false, error: 'You do not have access to this lead' });
      }

      const bookings = await prisma.booking.findMany({
        where: { tenantId, leadId: lead.id },
        include: {
          quotation: true,
          project: { select: { id: true, name: true, address: true, city: true } },
          unit: { select: { id: true, number: true, type: true, area: true, status: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          owner: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return res.json({ success: true, data: bookings });
    } catch (error) {
      console.error('Failed to fetch lead bookings:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch bookings' });
    }
  },
);

router.post(
  '/lead/:leadId/:bookingId/welcome-call',
  authenticate,
  authorizeEffectivePermission('CRM_WELCOME_CALL_COMPLETE'),
  async (req: AuthRequest, res: Response) => {
    try {
      const input = welcomeCallSchema.parse(req.body);
      const { tenantId, id: userId } = req.user!;
      const lead = await prisma.lead.findFirst({
        where: { id: req.params.leadId, tenantId },
      });
      if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
      if (!(await canAccessLead(req.user!, lead))) {
        return res.status(403).json({ success: false, error: 'You do not have access to this lead' });
      }

      const booking = await prisma.$transaction(async (tx) => {
        const current = await tx.booking.findFirst({
          where: { id: req.params.bookingId, leadId: lead.id, tenantId, status: { in: ['RESERVED', 'BOOKED'] } },
          include: {
            quotation: { select: { totalPrice: true } },
            receipts: {
              where: { approvalStatus: { in: ['APPROVED', 'ISSUED'] } },
              select: { amount: true },
            },
          },
        });
        if (!current) throw new Error('BOOKING_NOT_ACTIVE');

        const totalPaid = current.receipts.reduce((total, receipt) => total + receipt.amount, 0);
        if (totalPaid + 0.005 < current.quotation.totalPrice) throw new Error('PAYMENT_INCOMPLETE');

        const completedAt = new Date();
        const updated = await tx.booking.updateMany({
          where: { id: current.id, tenantId, status: { in: ['RESERVED', 'BOOKED'] }, welcomeCallCompletedAt: null },
          data: {
            status: 'CONFIRMED',
            bookingStage: 'WELCOME_CALL',
            welcomeCallCompletedAt: completedAt,
            welcomeCallCompletedById: userId,
            welcomeCallNotes: input.notes || null,
          },
        });
        if (updated.count !== 1) throw new Error('WELCOME_CALL_ALREADY_COMPLETED');

        const unitUpdate = await tx.unit.updateMany({
          where: { id: current.unitId, tenantId, status: 'RESERVED' },
          data: { status: 'BOOKED' },
        });
        if (unitUpdate.count !== 1) throw new Error('UNIT_NOT_RESERVED');

        await tx.lead.update({
          where: { id: lead.id },
          data: { status: 'BOOKED' },
        });
        await tx.activity.create({
          data: {
            tenantId,
            bookingId: current.id,
            leadId: lead.id,
            userId,
            type: 'CALL',
            subject: `Welcome call completed - ${current.bookingNumber}`,
            description: input.notes || 'Customer welcome call completed successfully after full payment.',
            notes: input.notes || null,
            status: 'COMPLETED',
            completedAt,
          },
        });

        return tx.booking.findUnique({
          where: { id: current.id },
          select: {
            id: true,
            bookingNumber: true,
            status: true,
            welcomeCallCompletedAt: true,
            welcomeCallNotes: true,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      await auditLog(tenantId, userId, 'BOOKING_WELCOME_CALL_COMPLETED', 'Booking', req.params.bookingId, undefined, {
        status: 'CONFIRMED',
        bookingStage: 'WELCOME_CALL',
        welcomeCallCompletedAt: booking?.welcomeCallCompletedAt,
      }, req.ip);
      return res.json({ success: true, data: booking });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: error.issues[0]?.message || 'Invalid welcome-call details' });
      }
      if (error instanceof Error && error.message === 'BOOKING_NOT_ACTIVE') {
        return res.status(409).json({ success: false, error: 'Only an active reserved booking can be confirmed' });
      }
      if (error instanceof Error && error.message === 'PAYMENT_INCOMPLETE') {
        return res.status(409).json({ success: false, error: 'The full quotation balance must be paid before completing the welcome call' });
      }
      if (error instanceof Error && error.message === 'WELCOME_CALL_ALREADY_COMPLETED') {
        return res.status(409).json({ success: false, error: 'The welcome call has already been completed' });
      }
      if (error instanceof Error && error.message === 'UNIT_NOT_RESERVED') {
        return res.status(409).json({ success: false, error: 'The unit is no longer reserved for this booking' });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        return res.status(409).json({ success: false, error: 'The booking payment or status changed. Refresh and try again.' });
      }
      console.error('Failed to complete booking welcome call:', error);
      return res.status(500).json({ success: false, error: 'Failed to complete welcome call' });
    }
  },
);

function bookingCompanyLogo(filename?: string | null): Buffer | null {
  if (!filename) return null;
  const safeName = path.basename(filename);
  if (safeName !== filename) return null;
  const extension = path.extname(safeName).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(extension)) return null;
  const logoPath = path.resolve(__dirname, '../../../uploads/logos', safeName);
  if (!fs.existsSync(logoPath)) return null;
  return fs.readFileSync(logoPath);
}

function bookingLocation(parts: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const items: string[] = [];
  parts.forEach((part) => {
    if (!part) return;
    part.split(',').forEach((piece) => {
      const cleaned = piece.trim();
      const key = cleaned.toLowerCase();
      if (!cleaned || seen.has(key)) return;
      seen.add(key);
      items.push(cleaned);
    });
  });
  return items.join(', ');
}

function bookingStatusLabel(status: string): string {
  if (status === 'BOOKED') return 'Booked';
  if (status === 'RESERVED') return 'Reserved';
  if (status === 'CONFIRMED') return 'Confirmed';
  if (status === 'CANCELLED') return 'Cancelled';
  return status;
}

function applicantPhoto(value: Prisma.JsonValue | undefined): Buffer | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const photo = Buffer.from(match[2], 'base64');
  return photo.length <= 1_000_000 ? photo : null;
}

function applicantFields(json: Prisma.JsonValue): Array<{ label: string; value: string }> {
  const applicant = asJsonObject(json);
  const display = (value: Prisma.JsonValue | undefined) => {
    if (value == null || value === '') return '—';
    return String(value);
  };
  const join = (values: Array<Prisma.JsonValue | undefined>) =>
    values.map(display).filter((value) => value !== '—').join(' ') || '—';
  return [
    { label: 'Full name', value: join([applicant.salutation, applicant.name]) },
    { label: 'Date of birth', value: display(applicant.dateOfBirth) },
    { label: 'Relation', value: join([applicant.relationType, applicant.relationshipName]) },
    { label: 'Nationality', value: display(applicant.nationality) },
    { label: 'Aadhaar number', value: display(applicant.aadhaarNumber) },
    { label: 'PAN number', value: display(applicant.panNumber) },
    { label: 'Email', value: display(applicant.email) },
    { label: 'Mobile number', value: display(applicant.mobileNumber) },
    { label: 'Alternate number', value: display(applicant.alternateNumber) },
    { label: 'Marital status', value: display(applicant.maritalStatus) },
    { label: 'State / district', value: join([applicant.state, applicant.district]) },
    { label: 'Corresponding address', value: display(applicant.correspondingAddress) },
    { label: 'Permanent address', value: display(applicant.permanentAddress) },
  ];
}

function paymentInstallments(value: Prisma.JsonValue): Array<{ milestone: string; percentage: number; dueMonths: number; dueDays?: number }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const installments = (value as Prisma.JsonObject).installments;
  if (!Array.isArray(installments)) return [];
  return installments.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Prisma.JsonObject;
    const percentage = Number(record.percentage);
    const dueMonths = Number(record.dueMonths);
    const dueDays = Number(record.dueDays);
    if (!Number.isFinite(percentage)) return [];
    return [{
      milestone: typeof record.milestone === 'string' ? record.milestone : 'Installment',
      percentage,
      dueMonths: Number.isFinite(dueMonths) ? dueMonths : 0,
      ...(Number.isFinite(dueDays) ? { dueDays } : {}),
    }];
  });
}

router.get(
  '/lead/:leadId/:bookingId/pdf',
  authenticate,
  authorize('Lead', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantId } = req.user!;
      const lead = await prisma.lead.findFirst({
        where: { id: req.params.leadId, tenantId },
        select: { id: true, tenantId: true, ownerId: true, creatorId: true, firstName: true, lastName: true, company: true },
      });
      if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
      if (!(await canAccessLead(req.user!, lead))) {
        return res.status(403).json({ success: false, error: 'You do not have access to this lead' });
      }

      const booking = await prisma.booking.findFirst({
        where: { id: req.params.bookingId, leadId: lead.id, tenantId },
        include: {
          quotation: true,
          project: { select: { name: true, address: true, city: true, state: true } },
          unit: { select: { number: true, type: true, block: true, floor: true, area: true, status: true } },
          owner: { select: { firstName: true, lastName: true } },
          createdBy: { select: { firstName: true, lastName: true } },
        },
      });
      if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });
      const tenant = await prisma.tenant.findFirst({
        where: { id: tenantId },
        select: { name: true, logo: true, email: true, phone: true, website: true, address: true, city: true, state: true, country: true, postalCode: true },
      });

      const fileName = `${booking.bookingNumber.replace(/[^A-Za-z0-9_-]/g, '-')}.pdf`;
      const profession = asJsonObject(booking.profession);
      const firstApplicant = asJsonObject(booking.firstApplicant);
      const applicants = [{
        title: 'First applicant',
        fields: applicantFields(booking.firstApplicant),
        photo: applicantPhoto(firstApplicant.photoUrl),
      }];
      if (booking.secondApplicant) {
        const secondApplicant = asJsonObject(booking.secondApplicant);
        applicants.push({
          title: 'Second applicant',
          fields: applicantFields(booking.secondApplicant),
          photo: applicantPhoto(secondApplicant.photoUrl),
        });
      }
      const extraApplicants = profession.additionalApplicants;
      if (Array.isArray(extraApplicants)) {
        extraApplicants.forEach((applicant, index) => {
          if (!applicant || typeof applicant !== 'object') return;
          const record = applicant as Prisma.JsonValue;
          applicants.push({
            title: index === 0 ? 'Third applicant' : 'Fourth applicant',
            fields: applicantFields(record),
            photo: applicantPhoto(asJsonObject(record).photoUrl),
          });
        });
      }
      const area = booking.quotation.area || booking.unit.area || 0;
      const pricePerSqFt = booking.quotation.pricePerSqFt || (area ? booking.quotation.basePrice / area : 0);
      const customerName = [firstApplicant.salutation, firstApplicant.name].filter((value) => typeof value === 'string' && value.trim()).join(' ')
        || [lead.firstName, lead.lastName].filter(Boolean).join(' ')
        || lead.company;
      const pdf = await renderQuotationPdf({
        companyName: tenant?.name || 'DCT CRM',
        companyAddress: bookingLocation([tenant?.address, tenant?.city, tenant?.state, tenant?.postalCode, tenant?.country]),
        companyPhone: tenant?.phone,
        companyEmail: tenant?.email,
        companyWebsite: tenant?.website,
        logo: bookingCompanyLogo(tenant?.logo),
        documentLabel: 'BOOKING',
        headerNumber: booking.bookingNumber,
        bookingNumber: booking.bookingNumber,
        bookingAmount: booking.bookingAmount,
        quotationNumber: booking.quotation.quotationNumber,
        quotationDate: booking.quotation.confirmedAt || booking.createdAt,
        status: bookingStatusLabel(booking.status),
        customerName,
        customerPhone: typeof firstApplicant.mobileNumber === 'string' ? firstApplicant.mobileNumber : null,
        customerEmail: typeof firstApplicant.email === 'string' ? firstApplicant.email : null,
        customerAddress: typeof firstApplicant.permanentAddress === 'string' ? firstApplicant.permanentAddress : null,
        organizationType: typeof profession.organizationType === 'string' ? profession.organizationType : null,
        projectName: booking.quotation.projectName || booking.project.name,
        projectAddress: bookingLocation([booking.project.address, booking.project.city, booking.project.state]),
        unitType: booking.quotation.unitType || booking.unit.type,
        unitNumber: booking.quotation.unitNumber || booking.unit.number,
        block: booking.unit.block,
        floor: booking.unit.floor,
        area,
        pricePerSqFt,
        basePrice: booking.quotation.basePrice,
        plcAmount: booking.quotation.plcAmount,
        discountAmount: booking.quotation.discountAmount,
        totalPrice: booking.quotation.totalPrice,
        paymentPlanName: booking.quotation.paymentPlanName,
        installments: paymentInstallments(booking.quotation.paymentPlan),
        terms: booking.quotation.terms,
        preparedBy: [booking.createdBy?.firstName, booking.createdBy?.lastName].filter(Boolean).join(' '),
        applicants,
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Length', pdf.length);
      return res.send(pdf);
    } catch (error) {
      console.error('Failed to export booking PDF:', error);
      return res.status(500).json({ success: false, error: 'Failed to export booking PDF' });
    }
  },
);

router.post(
  '/lead/:leadId/quotation/:quotationId',
  authenticate,
  authorize('Lead', 'edit'),
  async (req: AuthRequest, res: Response) => {
    try {
      const input = bookingSchema.parse(req.body);
      const { tenantId, id: userId } = req.user!;
      const lead = await prisma.lead.findFirst({
        where: { id: req.params.leadId, tenantId },
      });
      if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
      if (!(await canAccessLead(req.user!, lead))) {
        return res.status(403).json({ success: false, error: 'You do not have access to this lead' });
      }

      const quotation = await prisma.quotation.findFirst({
        where: {
          id: req.params.quotationId,
          leadId: lead.id,
          tenantId,
          status: 'CONFIRMED',
        },
        include: {
          booking: { select: { id: true, bookingNumber: true } },
          unit: { select: { id: true, tenantId: true, projectId: true, status: true } },
        },
      });
      if (!quotation) return res.status(404).json({ success: false, error: 'Quotation not found' });
      if (quotation.booking) {
        return res.status(409).json({ success: false, error: 'This quotation already has a booking' });
      }
      if (input.bookingAmount > quotation.totalPrice) {
        return res.status(400).json({ success: false, error: 'Booking amount cannot exceed the quotation total' });
      }
      if (
        quotation.unit.tenantId !== tenantId ||
        quotation.unit.projectId !== quotation.projectId ||
        quotation.unit.status !== 'AVAILABLE'
      ) {
        return res.status(409).json({ success: false, error: 'This unit is no longer available for booking' });
      }

      const firstApplicant = {
        ...input.firstApplicant,
        salutation: input.firstApplicant.salutation.trim(),
        name: input.firstApplicant.name.trim(),
        nationality: input.firstApplicant.nationality.trim(),
        aadhaarNumber: input.firstApplicant.aadhaarNumber.trim(),
        panNumber: input.firstApplicant.panNumber.trim().toUpperCase(),
        email: input.firstApplicant.email.trim(),
        mobileNumber: input.firstApplicant.mobileNumber.trim(),
        maritalStatus: input.firstApplicant.maritalStatus.trim(),
        state: input.firstApplicant.state.trim(),
        permanentAddress: input.firstApplicant.permanentAddress.trim(),
      };
      const withSharedAddress = <T extends { sameAddress?: boolean | null; correspondingAddress?: string | null; permanentAddress?: string | null; panNumber?: string | null }>(
        applicant: T,
      ) => ({
        ...applicant,
        panNumber: applicant.panNumber?.trim().toUpperCase(),
        correspondingAddress: applicant.sameAddress ? firstApplicant.correspondingAddress : applicant.correspondingAddress,
        permanentAddress: applicant.sameAddress ? firstApplicant.permanentAddress : applicant.permanentAddress,
      });
      const secondApplicant = input.secondApplicant?.name?.trim()
        ? {
            ...withSharedAddress(input.secondApplicant),
            name: input.secondApplicant.name.trim(),
          }
        : null;
      const additionalApplicants = (input.profession.additionalApplicants || []).map((applicant) => ({
        ...withSharedAddress(applicant),
        name: applicant.name.trim(),
        salutation: applicant.salutation.trim(),
      }));
      const booking = await prisma.$transaction(async (tx) => {
        const reservedUnit = await tx.unit.updateMany({
          where: { id: quotation.unitId, tenantId, status: 'AVAILABLE' },
          data: { status: 'RESERVED' },
        });
        if (reservedUnit.count !== 1) throw new UnitUnavailableError();

        const sequence = await tx.sequence.upsert({
          where: { tenantId_type: { tenantId, type: 'BOOKING' } },
          update: { nextValue: { increment: 1 } },
          create: { tenantId, type: 'BOOKING', nextValue: 1 },
        });
        const bookingNumber = `BK-${new Date().getFullYear()}-${String(sequence.nextValue).padStart(6, '0')}`;

        return tx.booking.create({
          data: {
            tenantId,
            leadId: lead.id,
            quotationId: quotation.id,
            projectId: quotation.projectId,
            unitId: quotation.unitId,
            createdById: userId,
            bookingNumber,
            status: 'RESERVED',
            bookingAmount: input.bookingAmount,
            plotDetails: {
              quotationNumber: quotation.quotationNumber,
              projectName: quotation.projectName,
              plotNumber: quotation.unitNumber,
              unitType: quotation.unitType,
              facingDirection: null,
              areaSqFt: quotation.area,
              areaCent: quotation.area / 435.6,
              basicPrice: quotation.basePrice,
              totalCostOfFlat: quotation.totalPrice,
              bookingAmount: input.bookingAmount,
            } as Prisma.InputJsonValue,
            firstApplicant: firstApplicant as Prisma.InputJsonValue,
            secondApplicant: secondApplicant as Prisma.InputJsonValue | undefined,
            profession: {
              organizationType: input.profession.organizationType,
              industry: input.profession.industry.trim(),
              ...(additionalApplicants.length ? { additionalApplicants } : {}),
            } as Prisma.InputJsonValue,
            referredBy: input.referredBy || null,
          },
          select: {
            id: true,
            bookingNumber: true,
            status: true,
            bookingAmount: true,
            createdAt: true,
          },
        });
      });

      await auditLog(tenantId, userId, 'BOOKING_CREATED', 'Booking', booking.id, undefined, {
        bookingNumber: booking.bookingNumber,
        quotationId: quotation.id,
        unitId: quotation.unitId,
        unitStatus: 'RESERVED',
      }, req.ip);
      await auditLog(tenantId, userId, 'UPDATE', 'Unit', quotation.unitId, { status: 'AVAILABLE' }, { status: 'RESERVED' }, req.ip);

      return res.status(201).json({ success: true, data: booking });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issue = error.issues[0];
        const field = issue?.path.join('.');
        const fieldLabels: Record<string, string> = {
          'firstApplicant.salutation': 'First applicant salutation',
          'firstApplicant.name': 'First applicant name',
          'firstApplicant.dateOfBirth': 'First applicant date of birth',
          'firstApplicant.nationality': 'First applicant nationality',
          'firstApplicant.aadhaarNumber': 'First applicant Aadhaar number',
          'firstApplicant.panNumber': 'First applicant PAN number',
          'firstApplicant.email': 'First applicant email',
          'firstApplicant.mobileNumber': 'First applicant mobile number',
          'firstApplicant.maritalStatus': 'First applicant marital status',
          'firstApplicant.state': 'First applicant state',
          'firstApplicant.permanentAddress': 'First applicant permanent address',
          'profession.organizationType': 'Organization type',
          'profession.industry': 'Industry',
          'secondApplicant': 'Second applicant',
          'bookingAmount': 'Booking amount',
        };
        const label = field ? fieldLabels[field] || field.split('.').join(' ') : 'Booking details';
        return res.status(400).json({
          success: false,
          field,
          error: `${label}: ${issue?.message || 'Invalid value'}`,
        });
      }
      if (error instanceof UnitUnavailableError || isUniqueConstraintError(error)) {
        return res.status(409).json({ success: false, error: 'This quotation or unit has already been booked' });
      }
      console.error('Failed to create booking from quotation:', error);
      return res.status(500).json({ success: false, error: 'Failed to create booking' });
    }
  },
);

export default router;
