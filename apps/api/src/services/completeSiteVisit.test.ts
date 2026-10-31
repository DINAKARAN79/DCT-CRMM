import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMPLETED_SITE_VISIT_STATUS,
  assertVisitCanBeCompleted,
  CompleteSiteVisitError,
  leadStatusAfterCompletedVisit,
  parseCompletedAt,
} from './completeSiteVisit';

describe('leadStatusAfterCompletedVisit', () => {
  it.each(['NEW', 'INCOMING', 'PROSPECT', 'SITE_VISIT_SCHEDULED'])(
    'moves %s to Site Visit Happened',
    (status) => {
      expect(leadStatusAfterCompletedVisit(status)).toBe('SITE_VISIT_HAPPENED');
    },
  );

  it.each(['SITE_VISIT_HAPPENED', 'BOOKED', 'LOST'])('leaves %s unchanged', (status) => {
    expect(leadStatusAfterCompletedVisit(status)).toBeNull();
  });
});

describe('complete site visit validation', () => {
  it('rejects a future completion time and a blank or cancelled visit', () => {
    expect(() => parseCompletedAt('2026-10-28T12:00:00.000Z', Date.parse('2026-10-28T11:00:00.000Z')))
      .toThrow(CompleteSiteVisitError);
    expect(() => assertVisitCanBeCompleted({ status: 'COMPLETED' }, false)).toThrow(/already Completed/);
    expect(() => assertVisitCanBeCompleted({ status: 'CANCELLED', cancellationReason: 'Customer declined' }, false))
      .toThrow(/Cancelled visits cannot be completed/);
    expect(() => assertVisitCanBeCompleted({ status: 'SCHEDULED' }, false)).not.toThrow();
    expect(() => assertVisitCanBeCompleted({ status: 'SCHEDULED' }, true)).not.toThrow();
  });

  it('uses the same Completed status the Quote Builder dropdown filters on', () => {
    const leadPage = readFileSync(
      resolve(__dirname, '../../../../apps/web/src/app/(dashboard)/leads/[id]/page.tsx'),
      'utf8',
    );
    expect(COMPLETED_SITE_VISIT_STATUS).toBe('COMPLETED');
    expect(leadPage).toContain('visit.status === "COMPLETED"');
  });
});
