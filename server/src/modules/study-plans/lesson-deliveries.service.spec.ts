import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UserRole } from '@biddaloy/shared';
import { LessonDeliveriesService } from './lesson-deliveries.service';

/** [66.2.03/#2008] Unit: the D29 window and the reason rules, with fakes for everything else. */
const SECTION = '00000000-0000-4000-8000-000000000001';
const SUBJECT = '00000000-0000-4000-8000-000000000002';
const SLOT = '00000000-0000-4000-8000-000000000003';
const TEACHER = 'teacher-1';

function build() {
  const manager = {
    transaction: vi.fn(async () => ({ id: 'saved' })),
    getRepository: () => ({ findOne: async () => ({ id: SUBJECT }) }),
  };
  const repo = { findOne: vi.fn(async () => null), manager };
  const resolver = {
    resolveRoutine: vi.fn(async (q: { from: string }) => [
      {
        date: q.from,
        section_id: SECTION,
        subject_id: SUBJECT,
        period_slot_id: SLOT,
        cancelled: false,
      },
    ]),
  };
  const schools = {
    getResolvedSettings: vi.fn(async () => ({ region: { timezone: 'Asia/Dhaka' } })),
  };
  const plans = {
    currentPlanFor: vi.fn(async () => ({ academic_year_id: 'y', owner_override_teacher_id: null })),
    ownerTeacherIds: vi.fn(async () => [TEACHER]),
  };
  const teacherRepo = { findOne: vi.fn(async () => ({ id: TEACHER })) };
  const service = new LessonDeliveriesService(
    repo as never,
    {} as never,
    {} as never,
    teacherRepo as never,
    {} as never,
    resolver as never,
    schools as never,
    {} as never,
    plans as never,
    {} as never,
  );
  const put = (date: string, role: string, extra: object = {}) =>
    service.put(
      {
        section_id: SECTION,
        subject_id: SUBJECT,
        period_slot_id: SLOT,
        date,
        status: 'TAUGHT',
        ...extra,
      } as never,
      't',
      { userId: 'u', tenantId: 't', role },
    );
  return { put };
}

describe('LessonDeliveriesService window (D29)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T06:00:00Z')); // noon on the 15th in Dhaka
  });
  afterEach(() => vi.useRealTimers());

  it('lets a teacher mark today and today-7', async () => {
    const { put } = build();
    await expect(put('2026-10-15', UserRole.TEACHER)).resolves.toBeDefined();
    await expect(put('2026-10-08', UserRole.TEACHER)).resolves.toBeDefined();
  });

  it('closes the window for a teacher at today-8 but not for ADMIN', async () => {
    const { put } = build();
    await expect(put('2026-10-07', UserRole.TEACHER)).rejects.toMatchObject({
      response: { details: { code: 'LESSON_DELIVERY_WINDOW_CLOSED' } },
    });
    await expect(put('2026-10-07', UserRole.ADMIN)).resolves.toBeDefined();
  });

  it('rejects tomorrow with 400 for everyone', async () => {
    const { put } = build();
    for (const role of [UserRole.TEACHER, UserRole.ADMIN]) {
      await expect(put('2026-10-16', role)).rejects.toMatchObject({ status: 400 });
    }
  });

  it('uses the school date after Dhaka midnight: the 8th is in, the 7th is out', async () => {
    // 18:30Z on the 14th is 00:30 on the 15th in Dhaka, so today is the 15th.
    vi.setSystemTime(new Date('2026-10-14T18:30:00Z'));
    const { put } = build();
    await expect(put('2026-10-08', UserRole.TEACHER)).resolves.toBeDefined();
    await expect(put('2026-10-07', UserRole.TEACHER)).rejects.toMatchObject({ status: 403 });
  });
});

describe('LessonDeliveriesService reason rules', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T06:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('NOT_TAUGHT without a reason is 400', async () => {
    const { put } = build();
    await expect(
      put('2026-10-15', UserRole.TEACHER, { status: 'NOT_TAUGHT' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('TAUGHT with a reason is 400', async () => {
    const { put } = build();
    await expect(put('2026-10-15', UserRole.TEACHER, { reason: 'OTHER' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('NOT_TAUGHT with a reason is accepted', async () => {
    const { put } = build();
    await expect(
      put('2026-10-15', UserRole.TEACHER, { status: 'NOT_TAUGHT', reason: 'OTHER' }),
    ).resolves.toBeDefined();
  });
});
