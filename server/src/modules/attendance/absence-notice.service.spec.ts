import { NotFoundException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AbsenceNoticeService,
  AbsenceNoticeSkipReason,
  DEFAULT_ABSENCE_NOTICE_TEMPLATE,
} from './absence-notice.service';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { Student } from '../students/entities/student.entity';
import { AttendanceSessionState, AttendanceStatus, CommunicationMedium } from '@biddaloy/shared';

const TENANT = 'tenant-1';
const SECTION = 'section-1';
const DATE = '2026-09-04';

function guardian(overrides: Partial<any> = {}) {
  return {
    id: 'g-1',
    full_name: 'Karim Uddin',
    phone: '01712345678',
    alternate_phone: null,
    email: null,
    is_primary_contact: true,
    notifications_enabled: true,
    preferred_communication: CommunicationMedium.SMS,
    ...overrides,
  };
}

function student(overrides: Partial<any> = {}) {
  return {
    id: 's-1',
    full_name: 'Rahim Uddin',
    guardians: [guardian()],
    ...overrides,
  };
}

function record(overrides: Partial<any> = {}) {
  return {
    id: 'rec-1',
    session_id: 'session-1',
    student_id: 's-1',
    status: AttendanceStatus.ABSENT,
    ...overrides,
  };
}

describe('AbsenceNoticeService', () => {
  let sessionRepo: any;
  let sectionRepo: any;
  let recordRepo: any;
  let studentRepo: any;
  let batchRepo: any;
  let logRepo: any;
  let queue: any;
  let dataSource: any;
  let auditService: any;
  let schoolsService: any;
  let service: AbsenceNoticeService;

  const finalizedSession = {
    id: 'session-1',
    tenant_id: TENANT,
    section_id: SECTION,
    date: DATE,
    period_no: null,
    state: AttendanceSessionState.FINALIZED,
    notified_at: null,
  };

  beforeEach(() => {
    sessionRepo = { findOne: vi.fn(async () => finalizedSession) };
    sectionRepo = {
      findOne: vi.fn(async () => ({
        id: SECTION,
        section_name: 'A',
        class: { name: 'Class 6' },
        tenant: { name: 'Green Valley School' },
      })),
    };
    recordRepo = { find: vi.fn(async () => [record()]) };
    studentRepo = { find: vi.fn(async () => [student()]) };
    batchRepo = {};
    logRepo = {};
    queue = { add: vi.fn(async () => undefined) };
    dataSource = {
      manager: {
        getRepository: (entity: any) => {
          if (entity === AttendanceRecord) return recordRepo;
          if (entity === Student) return studentRepo;
          throw new Error(`Unexpected repository requested: ${entity?.name}`);
        },
      },
    };
    auditService = { record: vi.fn(async () => undefined) };
    schoolsService = {};

    service = new AbsenceNoticeService(
      sessionRepo,
      recordRepo,
      sectionRepo,
      studentRepo,
      batchRepo,
      logRepo,
      queue,
      dataSource,
      auditService,
      schoolsService,
    );
  });

  it('groups one guardian with 3 absent children into a single recipient naming all 3', async () => {
    const g = guardian();
    recordRepo.find = vi.fn(async () => [
      record({ id: 'r1', student_id: 's-1' }),
      record({ id: 'r2', student_id: 's-2' }),
      record({ id: 'r3', student_id: 's-3' }),
    ]);
    studentRepo.find = vi.fn(async () => [
      student({ id: 's-1', full_name: 'Rahim', guardians: [g] }),
      student({ id: 's-2', full_name: 'Karim', guardians: [g] }),
      student({ id: 's-3', full_name: 'Ayesha', guardians: [g] }),
    ]);

    const { recipients, skipped } = await service.buildRecipients({
      tenantId: TENANT,
      sectionId: SECTION,
      date: DATE,
    });

    expect(recipients).toHaveLength(1);
    expect(recipients[0].guardian.id).toBe('g-1');
    expect(recipients[0].students.map((s) => s.full_name)).toEqual(['Rahim', 'Karim', 'Ayesha']);
    expect(recipients[0].vars.student_names).toBe('Rahim, Karim and Ayesha');
    expect(skipped).toEqual([]);
  });

  it('never includes LATE or LEAVE records — only ABSENT', async () => {
    recordRepo.find = vi.fn(async (opts: any) => {
      // Simulate the repo-level status filter: only ABSENT rows come back.
      expect(opts.where.status).toBe(AttendanceStatus.ABSENT);
      return [record({ status: AttendanceStatus.ABSENT })];
    });

    const { recipients } = await service.buildRecipients({
      tenantId: TENANT,
      sectionId: SECTION,
      date: DATE,
    });

    expect(recipients).toHaveLength(1);
  });

  it('returns no recipients and no skips when the register has no session yet', async () => {
    sessionRepo.findOne = vi.fn(async () => null);

    const { session, recipients, skipped } = await service.buildRecipients({
      tenantId: TENANT,
      sectionId: SECTION,
      date: DATE,
    });

    expect(session).toBeNull();
    expect(recipients).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it('throws NotFoundException instead of naming a blank section when the section is gone', async () => {
    // Soft-deleted after the session that references it was finalized —
    // `sectionRepo.findOne` excludes soft-deleted rows by default, so this
    // is the same shape as any other "section vanished" case.
    sectionRepo.findOne = vi.fn(async () => null);

    await expect(
      service.previewAbsenceNotice({
        tenantId: TENANT,
        sectionId: SECTION,
        date: DATE,
        userId: 'user-1',
        ip: null,
        userAgent: null,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns nothing for a DRAFT (not yet finalized) session', async () => {
    sessionRepo.findOne = vi.fn(async () => ({
      ...finalizedSession,
      state: AttendanceSessionState.DRAFT,
    }));

    const { recipients, skipped } = await service.buildRecipients({
      tenantId: TENANT,
      sectionId: SECTION,
      date: DATE,
    });

    expect(recipients).toEqual([]);
    expect(skipped).toEqual([]);
  });

  describe('skip reasons', () => {
    it('skips a student with no linked guardians as NO_GUARDIANS', async () => {
      studentRepo.find = vi.fn(async () => [student({ guardians: [] })]);

      const { skipped } = await service.buildRecipients({
        tenantId: TENANT,
        sectionId: SECTION,
        date: DATE,
      });

      expect(skipped).toEqual([
        { student_id: 's-1', guardian_id: null, reason: AbsenceNoticeSkipReason.NO_GUARDIANS },
      ]);
    });

    it('skips an opted-out guardian as NOTIFICATIONS_DISABLED', async () => {
      studentRepo.find = vi.fn(async () => [
        student({ guardians: [guardian({ notifications_enabled: false })] }),
      ]);

      const { skipped, recipients } = await service.buildRecipients({
        tenantId: TENANT,
        sectionId: SECTION,
        date: DATE,
      });

      expect(recipients).toEqual([]);
      expect(skipped).toEqual([
        {
          student_id: 's-1',
          guardian_id: 'g-1',
          reason: AbsenceNoticeSkipReason.NOTIFICATIONS_DISABLED,
        },
      ]);
    });

    it('skips a guardian whose preferred medium has no automated provider as NO_AUTOMATED_PROVIDER', async () => {
      studentRepo.find = vi.fn(async () => [
        student({
          guardians: [guardian({ preferred_communication: CommunicationMedium.PHONE_CALL })],
        }),
      ]);

      const { skipped, recipients } = await service.buildRecipients({
        tenantId: TENANT,
        sectionId: SECTION,
        date: DATE,
      });

      expect(recipients).toEqual([]);
      expect(skipped).toEqual([
        {
          student_id: 's-1',
          guardian_id: 'g-1',
          reason: AbsenceNoticeSkipReason.NO_AUTOMATED_PROVIDER,
        },
      ]);
    });

    it('skips a guardian with no address for their preferred medium as MISSING_ADDRESS', async () => {
      studentRepo.find = vi.fn(async () => [
        student({
          guardians: [
            guardian({ preferred_communication: CommunicationMedium.EMAIL, email: null }),
          ],
        }),
      ]);

      const { skipped, recipients } = await service.buildRecipients({
        tenantId: TENANT,
        sectionId: SECTION,
        date: DATE,
      });

      expect(recipients).toEqual([]);
      expect(skipped).toEqual([
        { student_id: 's-1', guardian_id: 'g-1', reason: AbsenceNoticeSkipReason.MISSING_ADDRESS },
      ]);
    });

    it('reports an unreachable guardian only once even with multiple absent children', async () => {
      const g = guardian({ preferred_communication: CommunicationMedium.PHONE_CALL });
      recordRepo.find = vi.fn(async () => [
        record({ id: 'r1', student_id: 's-1' }),
        record({ id: 'r2', student_id: 's-2' }),
      ]);
      studentRepo.find = vi.fn(async () => [
        student({ id: 's-1', guardians: [g] }),
        student({ id: 's-2', guardians: [g] }),
      ]);

      const { skipped } = await service.buildRecipients({
        tenantId: TENANT,
        sectionId: SECTION,
        date: DATE,
      });

      expect(skipped).toHaveLength(1);
    });
  });

  it('renders the default template with the resolved vars', () => {
    expect(DEFAULT_ABSENCE_NOTICE_TEMPLATE).toContain('{{student_names}}');
    expect(DEFAULT_ABSENCE_NOTICE_TEMPLATE).toContain('{{date}}');
    expect(DEFAULT_ABSENCE_NOTICE_TEMPLATE).toContain('{{section_name}}');
    expect(DEFAULT_ABSENCE_NOTICE_TEMPLATE).toContain('{{school_name}}');
  });
});
