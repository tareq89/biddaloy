import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import { StaffAttendanceService } from './staff-attendance.service';
import { StaffAttendanceSummaryService } from './staff-attendance-summary.service';
import { StaffAttendanceModule } from './staff-attendance.module';
import { AuthModule } from '../auth/auth.module';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { StaffProfile } from '../staff-profiles/entities/staff-profile.entity';
import { StaffAttendanceSession } from './entities/staff-attendance-session.entity';
import { StaffAttendanceRecord } from './entities/staff-attendance-record.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AttendanceStatus, AuditAction, UserRole } from '@biddaloy/shared';

/**
 * Integration tests for `StaffAttendanceService`/`StaffAttendanceSummaryService`
 * against a real, migrated test database — named `.spec.ts` per the [36.2.2]
 * plan (not `.integration.spec.ts`) since this ticket's own body names the
 * file this way; the content is nonetheless a DB-backed integration test,
 * same as `attendance.service.integration.spec.ts`.
 */
describe('StaffAttendanceService', () => {
  let service: StaffAttendanceService;
  let summaryService: StaffAttendanceSummaryService;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const ADMIN_USER_ID = SEED_ADMIN_USER_ID;
  let staffProfileId: string;
  let staffProfileId2: string;

  function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
  function addDays(days: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return isoDate(d);
  }
  const TODAY = () => addDays(0);
  const OUTSIDE_WINDOW = () => addDays(-10); // default correctionWindowDays is 2

  async function setTenantSettings(
    tenantId: string,
    attendance: Record<string, unknown>,
  ): Promise<void> {
    await dataSource
      .getRepository(School)
      .update({ id: tenantId }, { settings: { version: 1, attendance } as any });
  }

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), StaffAttendanceModule, AuthModule],
    );
    service = module.get<StaffAttendanceService>(StaffAttendanceService);
    summaryService = module.get<StaffAttendanceSummaryService>(StaffAttendanceSummaryService);
    dataSource = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await setTenantSettings(TENANT_ID, {
      weeklyOffDays: [],
      correctionWindowDays: 2,
      allowFutureDates: false,
      leaveCountsAsWorkingDay: false,
    });

    // `staff_attendance_records`/`staff_attendance_sessions`/`staff_profiles`
    // aren't in `test/reset-order.ts`'s transactional-table list yet (out of
    // this ticket's territory to add), so this file clears its own tenant's
    // rows before every test rather than relying on global truncation —
    // otherwise a session shared by `date` alone would leak marks between
    // tests that reuse the same relative date.
    await dataSource.query(`DELETE FROM staff_attendance_records WHERE tenant_id = $1`, [
      TENANT_ID,
    ]);
    await dataSource.query(`DELETE FROM staff_attendance_sessions WHERE tenant_id = $1`, [
      TENANT_ID,
    ]);
    await dataSource.query(`DELETE FROM staff_profiles WHERE tenant_id = $1`, [TENANT_ID]);

    const userRepo = dataSource.getRepository(User);
    const staffProfileRepo = dataSource.getRepository(StaffProfile);
    const user1 = await userRepo.save({
      email: `staff-att-${Date.now()}-${Math.random()}@test.com`,
      full_name: 'Staff Member One',
    });
    const user2 = await userRepo.save({
      email: `staff-att2-${Date.now()}-${Math.random()}@test.com`,
      full_name: 'Staff Member Two',
    });
    const profile1 = await staffProfileRepo.save({
      user_id: user1.id,
      tenant_id: TENANT_ID,
      employee_id: `EMP-TEST-${Date.now()}-1`,
    });
    const profile2 = await staffProfileRepo.save({
      user_id: user2.id,
      tenant_id: TENANT_ID,
      employee_id: `EMP-TEST-${Date.now()}-2`,
    });
    staffProfileId = profile1.id;
    staffProfileId2 = profile2.id;
  });

  function putParams(overrides: Record<string, unknown> = {}) {
    return {
      tenantId: TENANT_ID,
      role: UserRole.ADMIN,
      userId: ADMIN_USER_ID,
      ip: '127.0.0.1',
      userAgent: 'vitest',
      dto: {
        date: TODAY(),
        entries: [{ staff_profile_id: staffProfileId, status: AttendanceStatus.PRESENT }],
      },
      ...overrides,
    } as any;
  }

  describe('markDay', () => {
    it('creates a session and records on first mark', async () => {
      const result = await service.markDay(putParams());
      expect(result.records).toHaveLength(1);
      expect(result.records[0].status).toBe(AttendanceStatus.PRESENT);

      const sessionRepo = dataSource.getRepository(StaffAttendanceSession);
      const session = await sessionRepo.findOne({
        where: { tenant_id: TENANT_ID, date: TODAY() },
      });
      expect(session).not.toBeNull();

      const recordRepo = dataSource.getRepository(StaffAttendanceRecord);
      const records = await recordRepo.find({ where: { session_id: session!.id } });
      expect(records).toHaveLength(1);
    });

    it('re-marking the same day upserts, not duplicates', async () => {
      await service.markDay(putParams());
      const result = await service.markDay(
        putParams({
          dto: {
            date: TODAY(),
            entries: [{ staff_profile_id: staffProfileId, status: AttendanceStatus.ABSENT }],
          },
        }),
      );
      expect(result.records).toHaveLength(1);
      expect(result.records[0].status).toBe(AttendanceStatus.ABSENT);

      const recordRepo = dataSource.getRepository(StaffAttendanceRecord);
      const all = await recordRepo.find({ where: { tenant_id: TENANT_ID } });
      expect(all).toHaveLength(1);
    });

    it('rejects a correction outside the window without a reason', async () => {
      await service.markDay(
        putParams({
          dto: {
            date: OUTSIDE_WINDOW(),
            entries: [{ staff_profile_id: staffProfileId, status: AttendanceStatus.PRESENT }],
          },
        }),
      );

      await expect(
        service.markDay(
          putParams({
            dto: {
              date: OUTSIDE_WINDOW(),
              entries: [{ staff_profile_id: staffProfileId, status: AttendanceStatus.ABSENT }],
            },
          }),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('accepts a correction outside the window with a reason and audits it', async () => {
      await service.markDay(
        putParams({
          dto: {
            date: OUTSIDE_WINDOW(),
            entries: [{ staff_profile_id: staffProfileId, status: AttendanceStatus.PRESENT }],
          },
        }),
      );

      await service.markDay(
        putParams({
          dto: {
            date: OUTSIDE_WINDOW(),
            reason: 'late correction',
            entries: [{ staff_profile_id: staffProfileId, status: AttendanceStatus.ABSENT }],
          },
        }),
      );

      const auditRepo = dataSource.getRepository(AuditLog);
      const audits = await auditRepo.find({
        where: {
          tenant_id: TENANT_ID,
          entity_type: 'StaffAttendanceRecord',
          action: AuditAction.UPDATE,
        },
      });
      expect(audits.length).toBeGreaterThan(0);
    });

    it('a non-admin role may mark its own attendance', async () => {
      const user1 = await dataSource
        .getRepository(StaffProfile)
        .findOneOrFail({ where: { id: staffProfileId } });

      const result = await service.markDay(
        putParams({
          role: UserRole.TEACHER,
          userId: user1.user_id,
          dto: {
            date: TODAY(),
            entries: [{ staff_profile_id: staffProfileId, status: AttendanceStatus.PRESENT }],
          },
        }),
      );

      expect(result.records[0]?.staff_profile_id).toBe(staffProfileId);
    });

    it('403s a non-admin role marking a colleague (not their own staff profile)', async () => {
      const user1 = await dataSource
        .getRepository(StaffProfile)
        .findOneOrFail({ where: { id: staffProfileId } });

      await expect(
        service.markDay(
          putParams({
            role: UserRole.TEACHER,
            userId: user1.user_id,
            dto: {
              date: TODAY(),
              // staffProfileId2 belongs to a different user — not this caller's own.
              entries: [{ staff_profile_id: staffProfileId2, status: AttendanceStatus.PRESENT }],
            },
          }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getSummary', () => {
    it('matches the worked-example formula (present 19, late 2, absent 1, leave 1 of 23 working days -> 95.45%)', async () => {
      // 23 consecutive calendar days, weekly-off disabled above, so all 23
      // are working days.
      const start = new Date();
      start.setUTCDate(start.getUTCDate() - 30);
      const dates: string[] = [];
      for (let i = 0; i < 23; i++) {
        const d = new Date(start);
        d.setUTCDate(d.getUTCDate() + i);
        dates.push(isoDate(d));
      }

      const statuses = [
        ...Array(19).fill(AttendanceStatus.PRESENT),
        ...Array(2).fill(AttendanceStatus.LATE),
        ...Array(1).fill(AttendanceStatus.ABSENT),
        ...Array(1).fill(AttendanceStatus.LEAVE),
      ];

      for (let i = 0; i < dates.length; i++) {
        await service.markDay(
          putParams({
            dto: {
              date: dates[i],
              entries: [{ staff_profile_id: staffProfileId2, status: statuses[i] }],
            },
          }),
        );
      }

      const summary = await summaryService.getSummary({
        tenantId: TENANT_ID,
        staffProfileId: staffProfileId2,
        from: dates[0],
        to: dates[dates.length - 1],
        role: UserRole.ADMIN,
        userId: ADMIN_USER_ID,
      });

      expect(summary.working_days).toBe(23);
      expect(summary.present_days).toBe(19);
      expect(summary.late_days).toBe(2);
      expect(summary.absent_days).toBe(1);
      expect(summary.leave_days).toBe(1);
      expect(summary.attendance_percentage).toBe(95.45);
    });

    it("403s a non-admin role reading a colleague's summary (not their own staff profile)", async () => {
      const user1 = await dataSource
        .getRepository(StaffProfile)
        .findOneOrFail({ where: { id: staffProfileId } });

      await expect(
        summaryService.getSummary({
          tenantId: TENANT_ID,
          staffProfileId: staffProfileId2,
          from: TODAY(),
          to: TODAY(),
          role: UserRole.TEACHER,
          userId: user1.user_id,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('a non-admin role may read its own summary', async () => {
      const user1 = await dataSource
        .getRepository(StaffProfile)
        .findOneOrFail({ where: { id: staffProfileId } });

      await expect(
        summaryService.getSummary({
          tenantId: TENANT_ID,
          staffProfileId,
          from: TODAY(),
          to: TODAY(),
          role: UserRole.TEACHER,
          userId: user1.user_id,
        }),
      ).resolves.not.toThrow();
    });
  });
});
