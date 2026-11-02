import express from 'express';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  leadFindFirst: vi.fn(),
  quotationFindFirst: vi.fn(),
  bookingFindMany: vi.fn(),
  bookingFindFirst: vi.fn(),
  bookingFindUnique: vi.fn(),
  bookingUpdate: vi.fn(),
  bookingUpdateMany: vi.fn(),
  unitUpdateMany: vi.fn(),
  leadUpdate: vi.fn(),
  activityCreate: vi.fn(),
  activityFindMany: vi.fn(),
  activityCount: vi.fn(),
  followUpFindMany: vi.fn(),
  followUpCount: vi.fn(),
  auditLogFindMany: vi.fn(),
  auditLogCount: vi.fn(),
  auditLogWrite: vi.fn(),
  sequenceUpsert: vi.fn(),
  bookingCreate: vi.fn(),
  tenantFindFirst: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@dct-crm/db', () => ({
  prisma: {
    lead: { findFirst: database.leadFindFirst, update: database.leadUpdate },
    quotation: { findFirst: database.quotationFindFirst },
    booking: {
      findMany: database.bookingFindMany,
      findFirst: database.bookingFindFirst,
      findUnique: database.bookingFindUnique,
      update: database.bookingUpdate,
      updateMany: database.bookingUpdateMany,
    },
    unit: { updateMany: database.unitUpdateMany },
    activity: {
      create: database.activityCreate,
      findMany: database.activityFindMany,
      count: database.activityCount,
    },
    followUp: {
      findMany: database.followUpFindMany,
      count: database.followUpCount,
    },
    auditLog: {
      findMany: database.auditLogFindMany,
      count: database.auditLogCount,
    },
    tenant: { findFirst: database.tenantFindFirst },
    $transaction: database.transaction,
  },
}));

vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: ExpressResponse, next: NextFunction) => {
    Object.assign(req, { user: { id: 'sales-a', tenantId: 'tenant-a', isSuperAdmin: false, profileName: 'CRM' } });
    next();
  },
}));

vi.mock('../middleware/authorization', () => ({
  authorize: () => (_req: Request, _res: ExpressResponse, next: NextFunction) => next(),
  authorizeEffectivePermission: () => (_req: Request, _res: ExpressResponse, next: NextFunction) => next(),
}));

vi.mock('../middleware/audit', () => ({ auditLog: database.auditLogWrite }));
vi.mock('../services/recordAccess', () => ({ canAccessLead: vi.fn(async () => true) }));

import bookingsRouter from './bookings';
import { auditLog } from '../middleware/audit';

const servers: Server[] = [];
const tx = {
  unit: { updateMany: database.unitUpdateMany },
  sequence: { upsert: database.sequenceUpsert },
  booking: {
    create: database.bookingCreate,
    findFirst: database.bookingFindFirst,
    findUnique: database.bookingFindUnique,
    updateMany: database.bookingUpdateMany,
  },
  lead: { update: database.leadUpdate },
  activity: { create: database.activityCreate },
};

const bookingInput = {
  bookingAmount: 100000,
  firstApplicant: {
    salutation: 'Ms.',
    name: 'Asha Sharma',
    photoUrl: '',
    dateOfBirth: '1992-06-15',
    relationType: 'Daughter of',
    relationshipName: 'Ravi Sharma',
    nationality: 'Indian',
    aadhaarNumber: '123456789012',
    panNumber: 'ABCDE1234F',
    email: 'asha@example.com',
    mobileNumber: '9999999999',
    alternateNumber: '',
    maritalStatus: 'Single',
    state: 'Karnataka',
    district: 'Bengaluru',
    correspondingAddress: 'Bengaluru',
    permanentAddress: 'Bengaluru',
    sameAddress: false,
  },
  secondApplicant: null,
  profession: { organizationType: 'Company', industry: 'Technology' },
  referredBy: 'Customer',
};

async function createBooking(input: unknown = bookingInput) {
  const app = express();
  app.use(express.json());
  app.use('/api/bookings', bookingsRouter);
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
  return fetch(`http://127.0.0.1:${address.port}/api/bookings/lead/lead-a/quotation/quotation-a`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

async function getLeadBookings(leadId = 'lead-a') {
  const app = express();
  app.use('/api/bookings', bookingsRouter);
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
  return fetch(`http://127.0.0.1:${address.port}/api/bookings/lead/${leadId}`);
}

async function getBookingPdf(leadId = 'lead-a', bookingId = 'booking-a') {
  const app = express();
  app.use('/api/bookings', bookingsRouter);
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
  return fetch(`http://127.0.0.1:${address.port}/api/bookings/lead/${leadId}/${bookingId}/pdf`);
}

async function getBookingActivity(bookingId = 'booking-a', endpoint: 'activity-history' | 'audit-history' = 'activity-history') {
  const app = express();
  app.use('/api/bookings', bookingsRouter);
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
  return fetch(`http://127.0.0.1:${address.port}/api/bookings/${bookingId}/${endpoint}`);
}

async function updateBookingDetails(bookingId: string, details: unknown) {
  const app = express();
  app.use(express.json());
  app.use('/api/bookings', bookingsRouter);
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
  return fetch(`http://127.0.0.1:${address.port}/api/bookings/${bookingId}/details`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ details }),
  });
}

async function completeWelcomeCall(notes?: string) {
  const app = express();
  app.use(express.json());
  app.use('/api/bookings', bookingsRouter);
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
  return fetch(`http://127.0.0.1:${address.port}/api/bookings/lead/lead-a/booking-a/welcome-call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ notes }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  database.leadFindFirst.mockResolvedValue({
    id: 'lead-a',
    tenantId: 'tenant-a',
    ownerId: 'sales-a',
    creatorId: 'sales-a',
  });
  database.quotationFindFirst.mockResolvedValue({
    id: 'quotation-a',
    tenantId: 'tenant-a',
    projectId: 'project-a',
    unitId: 'unit-a',
    quotationNumber: 'QT-2026-000001',
    unitNumber: 'A-101',
    unitType: '2BHK',
    projectName: 'North Tower',
    area: 1000,
    basePrice: 1000000,
    totalPrice: 1000000,
    unit: { id: 'unit-a', tenantId: 'tenant-a', projectId: 'project-a', status: 'AVAILABLE' },
    booking: null,
  });
  database.bookingFindMany.mockResolvedValue([]);
  database.bookingFindFirst.mockResolvedValue({
    id: 'booking-a',
    bookingNumber: 'BK-2026-000002',
    status: 'RESERVED',
    details: {},
    bookingAmount: 100000,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    plotDetails: { areaCent: 2.3, facingDirection: 'North' },
    firstApplicant: {
      salutation: 'Ms.',
      name: 'Asha Sharma',
      photoUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB/cAAAAASUVORK5CYII=',
      dateOfBirth: '1992-06-15',
      nationality: 'Indian',
      aadhaarNumber: '123456789012',
      panNumber: 'ABCDE1234F',
      email: 'asha@example.com',
      mobileNumber: '9999999999',
      maritalStatus: 'Single',
      state: 'Karnataka',
      permanentAddress: 'Bengaluru',
    },
    secondApplicant: null,
    profession: { organizationType: 'Private company', industry: 'Technology' },
    referredBy: 'Customer',
    quotation: {
      quotationNumber: 'QT-2026-000001',
      basePrice: 1000000,
      plcAmount: 0,
      discountAmount: 0,
      totalPrice: 1000000,
      paymentPlanName: 'Standard plan',
      paymentPlan: { installments: [{ milestone: 'On confirmation', percentage: 100, dueMonths: 0 }] },
      terms: 'Booking terms apply',
    },
    project: { name: 'North Tower', address: 'Main Road', city: 'Bengaluru' },
    unit: { number: 'A-101', type: '2BHK', area: 1000, status: 'RESERVED' },
  });
  database.bookingFindUnique.mockResolvedValue({
    id: 'booking-a',
    bookingNumber: 'BK-2026-000002',
    status: 'CONFIRMED',
    welcomeCallCompletedAt: new Date('2026-10-15T12:00:00Z'),
    welcomeCallNotes: 'Customer welcomed',
  });
  database.bookingUpdateMany.mockResolvedValue({ count: 1 });
  database.bookingUpdate.mockImplementation(({ where, data }) => Promise.resolve({
    id: where.id,
    details: data.details,
    updatedAt: new Date('2026-10-29T00:00:00Z'),
  }));
  database.unitUpdateMany.mockResolvedValue({ count: 1 });
  database.leadUpdate.mockResolvedValue({ id: 'lead-a', status: 'BOOKED' });
  database.activityCreate.mockResolvedValue({ id: 'activity-a' });
  database.activityFindMany.mockResolvedValue([]);
  database.activityCount.mockResolvedValue(0);
  database.followUpFindMany.mockResolvedValue([]);
  database.followUpCount.mockResolvedValue(0);
  database.auditLogFindMany.mockResolvedValue([]);
  database.auditLogCount.mockResolvedValue(0);
  database.tenantFindFirst.mockResolvedValue({
    name: 'DCT Real Estate',
    logo: null,
    email: 'hello@dct.example',
    phone: '04440000000',
    website: null,
    address: 'Tambaram',
    city: 'Chennai',
    state: 'Tamil Nadu',
    country: 'India',
    postalCode: '600045',
  });
  database.sequenceUpsert.mockResolvedValue({ nextValue: 2 });
  database.bookingCreate.mockImplementation(({ data }) => Promise.resolve({
    id: 'booking-a',
    bookingNumber: data.bookingNumber,
    status: data.status,
    bookingAmount: data.bookingAmount,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  }));
  database.transaction.mockImplementation((callback) => callback(tx));
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe('POST /api/bookings/lead/:leadId/quotation/:quotationId', () => {
  it('saves the applicant details and reserves the quoted unit atomically', async () => {
    const response = await createBooking();
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      success: true,
      data: {
        bookingNumber: expect.stringMatching(/^BK-\d{4}-000002$/),
        status: 'RESERVED',
        bookingAmount: 100000,
      },
    });

    describe('POST /api/bookings/lead/:leadId/:bookingId/welcome-call', () => {
      it('requires the full quotation balance before completing the welcome call', async () => {
        database.bookingFindFirst.mockResolvedValue({
          id: 'booking-a',
          bookingNumber: 'BK-2026-000002',
          unitId: 'unit-a',
          quotation: { totalPrice: 100000 },
          receipts: [{ amount: 50000 }],
        });

        const response = await completeWelcomeCall();
        const body = await response.json();

        expect(response.status).toBe(409);
        expect(body).toMatchObject({ error: expect.stringMatching(/full quotation balance/i) });
        expect(database.bookingUpdateMany).not.toHaveBeenCalled();
        expect(database.activityCreate).not.toHaveBeenCalled();
      });

      it('confirms the booking, marks the unit booked, and logs a completed welcome call', async () => {
        database.bookingFindFirst.mockResolvedValue({
          id: 'booking-a',
          bookingNumber: 'BK-2026-000002',
          unitId: 'unit-a',
          quotation: { totalPrice: 100000 },
          receipts: [{ amount: 25000 }, { amount: 75000 }],
        });

        const response = await completeWelcomeCall('Customer welcomed');
        expect(response.status).toBe(200);
        expect(database.bookingUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
          where: { id: 'booking-a', tenantId: 'tenant-a', status: { in: ['RESERVED', 'BOOKED'] }, welcomeCallCompletedAt: null },
          data: expect.objectContaining({
            status: 'CONFIRMED',
            welcomeCallCompletedById: 'sales-a',
            welcomeCallNotes: 'Customer welcomed',
          }),
        }));
        expect(database.unitUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
          where: { id: 'unit-a', tenantId: 'tenant-a', status: 'RESERVED' },
          data: { status: 'BOOKED' },
        }));
        expect(database.leadUpdate).toHaveBeenCalledWith({
          where: { id: 'lead-a' },
          data: { status: 'BOOKED' },
        });
        expect(database.activityCreate).toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({
            bookingId: 'booking-a',
            leadId: 'lead-a',
            type: 'CALL',
            status: 'COMPLETED',
            subject: expect.stringMatching(/welcome call completed/i),
          }),
        }));
      });
    });
    expect(database.unitUpdateMany).toHaveBeenCalledWith({
      where: { id: 'unit-a', tenantId: 'tenant-a', status: 'AVAILABLE' },
      data: { status: 'RESERVED' },
    });
    expect(database.bookingCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        quotationId: 'quotation-a',
        firstApplicant: expect.objectContaining({ name: 'Asha Sharma', aadhaarNumber: '123456789012' }),
        plotDetails: expect.objectContaining({ plotNumber: 'A-101', bookingAmount: 100000 }),
      }),
    }));
  });

  it('rejects a unit that has already become unavailable', async () => {
    database.unitUpdateMany.mockResolvedValue({ count: 0 });

    const response = await createBooking();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ success: false });
    expect(database.bookingCreate).not.toHaveBeenCalled();
  });

  it('rejects a quotation that already has a booking', async () => {
    database.quotationFindFirst.mockResolvedValue({
      ...(await database.quotationFindFirst()),
      booking: { id: 'booking-existing', bookingNumber: 'BK-2026-000001' },
    });

    const response = await createBooking();

    expect(response.status).toBe(409);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('rejects an invalid applicant birth date before reserving the unit', async () => {
    const response = await createBooking({
      ...bookingInput,
      firstApplicant: { ...bookingInput.firstApplicant, dateOfBirth: '1992-02-31' },
    });

    expect(response.status).toBe(400);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('identifies the missing applicant salutation instead of returning a generic validation error', async () => {
    const response = await createBooking({
      ...bookingInput,
      firstApplicant: { ...bookingInput.firstApplicant, salutation: '' },
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      field: 'firstApplicant.salutation',
      error: 'First applicant salutation: Salutation is required',
    });
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('does not silently discard partial second-applicant details', async () => {
    const response = await createBooking({
      ...bookingInput,
      secondApplicant: { name: '', mobileNumber: '9999999999' },
    });

    expect(response.status).toBe(400);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('rejects WebP applicant photos because the booking PDF supports JPG and PNG', async () => {
    const response = await createBooking({
      ...bookingInput,
      firstApplicant: {
        ...bookingInput.firstApplicant,
        photoUrl: 'data:image/webp;base64,AAAA',
      },
    });

    expect(response.status).toBe(400);
    expect(database.transaction).not.toHaveBeenCalled();
  });
});

describe('GET /api/bookings/lead/:leadId', () => {
  it('returns only bookings belonging to the requested tenant and lead', async () => {
    const response = await getLeadBookings();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: [] });
    expect(database.bookingFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-a', leadId: 'lead-a' },
    }));
  });
});

describe('GET /api/bookings/:bookingId/activity-history', () => {
  it('returns only activities and follow-ups attached to the requested booking', async () => {
    database.activityFindMany.mockResolvedValue([{
      id: 'booking-activity',
      type: 'SYSTEM',
      subject: 'Booking status updated',
      createdAt: new Date('2026-10-29T10:00:00Z'),
      user: { id: 'sales-a', firstName: 'Sales', lastName: 'User' },
    }]);
    database.activityCount.mockResolvedValue(1);
    database.followUpFindMany.mockResolvedValue([{
      id: 'booking-follow-up',
      title: 'Call about booking',
      description: 'Confirm documents',
      comments: null,
      dueDate: new Date('2026-10-30T10:00:00Z'),
      status: 'SCHEDULED',
      createdAt: new Date('2026-10-29T09:00:00Z'),
      owner: { id: 'sales-a', firstName: 'Sales', lastName: 'User' },
    }]);
    database.followUpCount.mockResolvedValue(1);

    const response = await getBookingActivity();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: [
        { id: 'booking-activity', subject: 'Booking status updated' },
        { id: 'booking-follow-up', type: 'FOLLOW_UP', subject: 'Call about booking' },
      ],
      pagination: { total: 2 },
    });
    expect(database.activityFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-a', bookingId: 'booking-a' },
    }));
    expect(database.followUpFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-a', bookingId: 'booking-a' },
    }));
  });
});

describe('GET /api/bookings/:bookingId/audit-history', () => {
  it('returns history scoped to the booking object, not its associated lead', async () => {
    database.auditLogFindMany.mockResolvedValue([{
      id: 'booking-history',
      action: 'UPDATE',
      objectType: 'Booking',
      objectId: 'booking-a',
      oldValues: { bookingStage: 'NEW_BOOKING' },
      newValues: { bookingStage: 'WELCOME_CALL' },
      createdAt: new Date('2026-10-29T10:00:00Z'),
      user: { id: 'sales-a', firstName: 'Sales', lastName: 'User', email: 'sales@example.com' },
      impersonatedById: null,
    }]);
    database.auditLogCount.mockResolvedValue(1);

    const response = await getBookingActivity('booking-a', 'audit-history');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: [{ id: 'booking-history', objectType: 'Booking', objectId: 'booking-a' }],
    });
    expect(database.auditLogFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-a', objectType: 'Booking', objectId: 'booking-a' },
    }));
  });
});

describe('GET /api/bookings/lead/:leadId/:bookingId/pdf', () => {
  it('downloads a PDF containing the booking record', async () => {
    const response = await getBookingPdf();
    const pdf = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/pdf');
    expect(response.headers.get('content-disposition')).toContain('BK-2026-000002.pdf');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(2000);
    const pdfText = pdf.toString('latin1');
    expect(pdfText).toContain('/Subtype /Image');
    const pages = pdfText.match(/\/Type \/Page(?!s)/g) || [];
    expect(pages.length).toBeGreaterThan(0);
    expect(database.bookingFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'booking-a', leadId: 'lead-a', tenantId: 'tenant-a' },
    }));
  });

  it('returns 404 when the booking is not attached to the lead', async () => {
    database.bookingFindFirst.mockResolvedValue(null);
    const response = await getBookingPdf();

    expect(response.status).toBe(404);
  });
});

describe('PATCH /api/bookings/:bookingId/details', () => {
  it('saves editable booking fields without replacing existing details', async () => {
    database.bookingFindFirst.mockResolvedValueOnce({
      id: 'booking-a',
      details: { existingField: 'keep me' },
    });

    const response = await updateBookingDetails('booking-a', {
      bankStatus: 'Approved',
      isSwapped: false,
      ratePerSqFt: 1491,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { details: { existingField: 'keep me', bankStatus: 'Approved', isSwapped: false, ratePerSqFt: 1491 } },
    });
    expect(database.bookingFindFirst).toHaveBeenCalledWith({
      where: { id: 'booking-a', tenantId: 'tenant-a' },
      select: { id: true, details: true },
    });
    expect(database.bookingUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'booking-a' },
      data: { details: { existingField: 'keep me', bankStatus: 'Approved', isSwapped: false, ratePerSqFt: 1491 } },
    }));
  });

  it('audits only changed editable fields and masks personal details', async () => {
    database.bookingFindFirst.mockResolvedValueOnce({
      id: 'booking-a',
      details: { bankStatus: 'Pending', bankExecutiveName: 'Private Person' },
    });

    const response = await updateBookingDetails('booking-a', {
      bankStatus: 'Approved',
      bankExecutiveName: 'Another Private Person',
    });

    expect(response.status).toBe(200);
    expect(auditLog).toHaveBeenCalledWith(
      'tenant-a',
      'sales-a',
      'BOOKING_DETAILS_UPDATED',
      'Booking',
      'booking-a',
      undefined,
      {
        changes: [
          { field: 'bankStatus', label: 'Bank Status', oldValue: 'Pending', newValue: 'Approved' },
          {
            field: 'bankExecutiveName',
            label: 'Bank Executive Name',
            oldValue: 'Hidden for privacy',
            newValue: 'Hidden for privacy',
          },
        ],
      },
      expect.any(String),
    );
    expect(JSON.stringify(vi.mocked(auditLog).mock.calls)).not.toContain('Private Person');
  });

  it('does not create repetitive history for unchanged booking details', async () => {
    database.bookingFindFirst.mockResolvedValueOnce({
      id: 'booking-a',
      details: { bankStatus: 'Approved' },
    });

    const response = await updateBookingDetails('booking-a', { bankStatus: 'Approved' });

    expect(response.status).toBe(200);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('rejects unknown and read-only booking fields', async () => {
    const response = await updateBookingDetails('booking-a', {
      unexpectedField: 'not allowed',
      bookingNumber: 'BK-CHANGED',
    });

    expect(response.status).toBe(400);
    expect(database.bookingUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 for a booking outside the current tenant', async () => {
    database.bookingFindFirst.mockResolvedValueOnce(null);

    const response = await updateBookingDetails('booking-other-tenant', { bankStatus: 'Approved' });

    expect(response.status).toBe(404);
    expect(database.bookingUpdate).not.toHaveBeenCalled();
  });
});
