import { DocumentKind } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import { kindAvailability, type LifecycleEventLike } from './kind-eligibility';

const ev = (event_type: string, occurred_on: string): LifecycleEventLike => ({
  event_type,
  occurred_on,
});
const base = { enrollmentStatus: 'ACTIVE', events: [] as LifecycleEventLike[], hasTemplate: true };

describe('kindAvailability', () => {
  it('TC is ok after a transfer', () => {
    expect(
      kindAvailability(DocumentKind.TRANSFER_CERTIFICATE, {
        ...base,
        enrollmentStatus: 'TRANSFERRED',
        events: [ev('TRANSFERRED_OUT', '2026-09-01')],
      }),
    ).toEqual({ ok: true });
  });
  it('a later READMITTED cancels the leaving', () => {
    expect(
      kindAvailability(DocumentKind.TRANSFER_CERTIFICATE, {
        ...base,
        events: [ev('TRANSFERRED_OUT', '2026-09-01'), ev('READMITTED', '2026-09-10')],
      }),
    ).toEqual({ ok: false, reason: 'NO_LEAVING_EVENT' });
  });
  it('TC with no events is refused', () => {
    expect(kindAvailability(DocumentKind.TRANSFER_CERTIFICATE, base)).toEqual({
      ok: false,
      reason: 'NO_LEAVING_EVENT',
    });
  });
  it('testimonial: graduated ok, transferred refused', () => {
    expect(
      kindAvailability(DocumentKind.TESTIMONIAL, { ...base, enrollmentStatus: 'GRADUATED' }),
    ).toEqual({ ok: true });
    expect(
      kindAvailability(DocumentKind.TESTIMONIAL, { ...base, enrollmentStatus: 'TRANSFERRED' }),
    ).toEqual({ ok: false, reason: 'NOT_CURRENT_OR_GRADUATED' });
  });
  it('study certificate needs an active student', () => {
    expect(
      kindAvailability(DocumentKind.STUDY_CERTIFICATE, { ...base, enrollmentStatus: 'INACTIVE' }),
    ).toEqual({ ok: false, reason: 'NOT_CURRENT' });
  });
  it('no template wins for an otherwise fine kind', () => {
    expect(
      kindAvailability(DocumentKind.CHARACTER_CERTIFICATE, { ...base, hasTemplate: false }),
    ).toEqual({ ok: false, reason: 'NO_TEMPLATE' });
  });
});
