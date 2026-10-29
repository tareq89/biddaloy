import { describe, it, expect, vi } from 'vitest';
import {
  ArrivalNoticeChannel,
  ArrivalNoticeLock,
  ArrivalNoticeMode,
  ArrivalNoticeStatus,
  UserRole,
} from '@biddaloy/shared';
import { ARRIVAL_ERRORS, ArrivalSubscriptionsService } from './arrival-subscriptions.service';

const TENANT = 'tenant-1';

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    tenant_id: TENANT,
    student_id: 'st-1',
    guardian_id: 'g-1',
    status: ArrivalNoticeStatus.REQUESTED,
    mode: ArrivalNoticeMode.RECURRING,
    channel: ArrivalNoticeChannel.PUSH,
    lock: ArrivalNoticeLock.NONE,
    consumed_at: null as Date | null,
    updated_at: new Date(),
    ...over,
  };
}

function build(opts: { existing?: ReturnType<typeof row> | null; smsAllowed?: boolean } = {}) {
  const existing = opts.existing === undefined ? row() : opts.existing;
  const repo = {
    findOne: vi.fn().mockResolvedValue(existing),
    create: vi.fn((v) => v),
    save: vi.fn(async (v) => ({ id: 'sub-1', updated_at: new Date(), ...v })),
  } as any;
  // Student lookup: in homeroom section "sec-1".
  const studentRepo = {
    findOne: vi.fn().mockResolvedValue({ id: 'st-1', class_section_id: 'sec-1' }),
    createQueryBuilder: vi.fn(() => {
      const qb: any = {};
      for (const m of [
        'select',
        'addSelect',
        'innerJoin',
        'where',
        'andWhere',
        'orderBy',
        'addOrderBy',
      ]) {
        qb[m] = vi.fn(() => qb);
      }
      qb.getRawOne = vi.fn().mockResolvedValue({ guardian_id: 'g-1' });
      qb.getCount = vi.fn().mockResolvedValue(1);
      return qb;
    }),
  } as any;
  const teacherScope = {
    homeroomSections: vi.fn().mockResolvedValue([{ section_id: 'sec-1' }]),
  } as any;
  const schools = {
    getResolvedSettings: vi.fn().mockResolvedValue({
      attendance: { arrivalNotice: { enabled: true, smsAllowed: opts.smsAllowed ?? false } },
    }),
  } as any;
  const service = new ArrivalSubscriptionsService(repo, studentRepo, teacherScope, schools);
  return { service, repo, studentRepo, teacherScope };
}

const teacher = { tenantId: TENANT, userId: 'u-t', role: UserRole.TEACHER, canLock: false };
const admin = { tenantId: TENANT, userId: 'u-a', role: UserRole.ADMIN, canLock: true };

describe('ArrivalSubscriptionsService.update', () => {
  it('confirm moves REQUESTED to ACTIVE with the chosen mode', async () => {
    const { service } = build();
    const out = await service.update(teacher, 'sub-1', {
      status: ArrivalNoticeStatus.ACTIVE,
      mode: ArrivalNoticeMode.ONCE,
    });
    expect(out.status).toBe(ArrivalNoticeStatus.ACTIVE);
    expect(out.mode).toBe(ArrivalNoticeMode.ONCE);
  });

  it('decline moves to OFF and leaves consumed_at null', async () => {
    const { service } = build({ existing: row({ consumed_at: new Date() }) });
    const out = await service.update(teacher, 'sub-1', { status: ArrivalNoticeStatus.OFF });
    expect(out.status).toBe(ArrivalNoticeStatus.OFF);
    expect(out.consumed_at).toBeNull();
  });

  it('NEVER lock refuses a teacher confirm with the fixed sentence', async () => {
    const { service } = build({ existing: row({ lock: ArrivalNoticeLock.NEVER }) });
    await expect(
      service.update(teacher, 'sub-1', { status: ArrivalNoticeStatus.ACTIVE }),
    ).rejects.toThrow(ARRIVAL_ERRORS.lockedNever);
  });

  it('ALWAYS lock refuses a teacher change but not an admin with the lock permission', async () => {
    const { service } = build({ existing: row({ lock: ArrivalNoticeLock.ALWAYS }) });
    await expect(
      service.update(teacher, 'sub-1', { status: ArrivalNoticeStatus.OFF }),
    ).rejects.toThrow(ARRIVAL_ERRORS.lockedForTeacher);
    await expect(
      service.update(admin, 'sub-1', { mode: ArrivalNoticeMode.RECURRING }),
    ).resolves.toBeDefined();
  });

  // D35: ALWAYS is ACTIVE + RECURRING; ONCE or OFF would make the row stop by itself.
  it('ALWAYS lock refuses ONCE and OFF even for an admin with the lock permission', async () => {
    const { service } = build({ existing: row({ lock: ArrivalNoticeLock.ALWAYS }) });
    await expect(service.update(admin, 'sub-1', { mode: ArrivalNoticeMode.ONCE })).rejects.toThrow(
      ARRIVAL_ERRORS.lockedAlways,
    );
    await expect(
      service.update(admin, 'sub-1', { status: ArrivalNoticeStatus.OFF }),
    ).rejects.toThrow(ARRIVAL_ERRORS.lockedAlways);
  });

  it('is 404 for a row whose student sits outside the teacher homeroom', async () => {
    const { service, teacherScope } = build();
    teacherScope.homeroomSections.mockResolvedValue([{ section_id: 'other' }]);
    await expect(
      service.update(teacher, 'sub-1', { status: ArrivalNoticeStatus.ACTIVE }),
    ).rejects.toThrow(ARRIVAL_ERRORS.notFound);
  });
});

describe('ArrivalSubscriptionsService.setLock', () => {
  it('ALWAYS forces ACTIVE + RECURRING', async () => {
    const { service } = build({
      existing: row({ status: ArrivalNoticeStatus.OFF, mode: ArrivalNoticeMode.ONCE }),
    });
    const out = await service.setLock(admin, 'sub-1', ArrivalNoticeLock.ALWAYS);
    expect(out.status).toBe(ArrivalNoticeStatus.ACTIVE);
    expect(out.mode).toBe(ArrivalNoticeMode.RECURRING);
  });

  it('NEVER forces OFF; NONE leaves the row as it is', async () => {
    const never = await build({
      existing: row({ status: ArrivalNoticeStatus.ACTIVE }),
    }).service.setLock(admin, 'sub-1', ArrivalNoticeLock.NEVER);
    expect(never.status).toBe(ArrivalNoticeStatus.OFF);

    const none = await build({
      existing: row({ status: ArrivalNoticeStatus.ACTIVE, lock: ArrivalNoticeLock.ALWAYS }),
    }).service.setLock(admin, 'sub-1', ArrivalNoticeLock.NONE);
    expect(none.status).toBe(ArrivalNoticeStatus.ACTIVE);
  });
});

describe('ArrivalSubscriptionsService.upsertByGuardian', () => {
  const input = { tenantId: TENANT, guardianUserId: 'u-g', studentId: 'st-1' };

  it('creates a REQUESTED row on want=true', async () => {
    const { service } = build({ existing: null });
    const out = await service.upsertByGuardian({ ...input, want: true });
    expect(out?.status).toBe(ArrivalNoticeStatus.REQUESTED);
  });

  it('re-request after a consumed ONCE is REQUESTED again with consumed_at cleared (D20)', async () => {
    const { service } = build({
      existing: row({ status: ArrivalNoticeStatus.OFF, consumed_at: new Date() }),
    });
    const out = await service.upsertByGuardian({ ...input, want: true });
    expect(out?.status).toBe(ArrivalNoticeStatus.REQUESTED);
    expect(out?.consumed_at).toBeNull();
  });

  it('keeps an ACTIVE row ACTIVE on want=true', async () => {
    const { service } = build({ existing: row({ status: ArrivalNoticeStatus.ACTIVE }) });
    const out = await service.upsertByGuardian({ ...input, want: true });
    expect(out?.status).toBe(ArrivalNoticeStatus.ACTIVE);
  });

  it('NEVER lock refuses the guardian; ALWAYS refuses switching off', async () => {
    await expect(
      build({ existing: row({ lock: ArrivalNoticeLock.NEVER }) }).service.upsertByGuardian({
        ...input,
        want: true,
      }),
    ).rejects.toThrow(ARRIVAL_ERRORS.lockedNever);
    await expect(
      build({ existing: row({ lock: ArrivalNoticeLock.ALWAYS }) }).service.upsertByGuardian({
        ...input,
        want: false,
      }),
    ).rejects.toThrow(ARRIVAL_ERRORS.lockedAlways);
  });

  it('refuses SMS when the school does not allow it, allows it when it does', async () => {
    await expect(
      build({ smsAllowed: false }).service.upsertByGuardian({
        ...input,
        want: true,
        channel: ArrivalNoticeChannel.SMS,
      }),
    ).rejects.toThrow(ARRIVAL_ERRORS.smsNotAllowed);
    const out = await build({ smsAllowed: true }).service.upsertByGuardian({
      ...input,
      want: true,
      channel: ArrivalNoticeChannel.SMS,
    });
    expect(out?.channel).toBe(ArrivalNoticeChannel.SMS);
  });

  it('is 404 when the caller is not linked to the student', async () => {
    const { service, studentRepo } = build();
    studentRepo.createQueryBuilder.mockImplementation(() => {
      const qb: any = {};
      for (const m of [
        'select',
        'addSelect',
        'innerJoin',
        'where',
        'andWhere',
        'orderBy',
        'addOrderBy',
      ]) {
        qb[m] = vi.fn(() => qb);
      }
      qb.getRawOne = vi.fn().mockResolvedValue(undefined);
      return qb;
    });
    await expect(service.upsertByGuardian({ ...input, want: true })).rejects.toThrow(
      ARRIVAL_ERRORS.studentNotFound,
    );
  });
});

describe('ArrivalSubscriptionsService.listForStaff', () => {
  it('gives a teacher with no homeroom an empty list and a foreign section 404', async () => {
    const { service, teacherScope } = build();
    teacherScope.homeroomSections.mockResolvedValue([]);
    await expect(service.listForStaff(teacher, {})).resolves.toEqual([]);
    teacherScope.homeroomSections.mockResolvedValue([{ section_id: 'sec-1' }]);
    await expect(service.listForStaff(teacher, { sectionId: 'sec-9' })).rejects.toThrow(
      ARRIVAL_ERRORS.notFound,
    );
  });
});
