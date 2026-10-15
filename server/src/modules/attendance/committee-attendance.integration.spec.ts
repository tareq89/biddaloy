import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { AttendanceSessionState, AttendanceStatus, DashboardWidgetKey } from '@biddaloy/shared';
import { AttendanceModule } from './attendance.module';
import { AuthModule } from '../auth/auth.module';
import { AttendanceDashboardService } from './attendance-dashboard.service';
import { computeAttendancePercentage } from './attendance-summary.service';
import { AttendanceSession } from './entities/attendance-session.entity';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { TENANT_STATUS_REDIS } from '../schools/tenant-status.service';
import { enrollStudent } from '@test/helpers/enrollment.helper';

/**
 * [8.10.7.4.08] Committee card: attendance % per month of the current academic year.
 * Clock is faked to 2026-10-20 (Dhaka), so months run 2026-01 .. 2026-10.
 */
describe('AttendanceDashboardService.getCommitteeMonthly (integration)', () => {
  let service: AttendanceDashboardService;
  let dataSource: DataSource;
  let redis: Redis;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000097';
  const NOW = '2026-10-20T06:00:00Z';
  let yearId: string;
  let sec: string;
  let oldYearSec: string; // section of last year: must never count
  let otherSec: string;
  let n = 0;

  const P = AttendanceStatus.PRESENT;
  const L = AttendanceStatus.LATE;
  const A = AttendanceStatus.ABSENT;
  const V = AttendanceStatus.LEAVE;

  async function setSettings(extra: object = {}) {
    await dataSource
      .getRepository(School)
      .update(
        { id: TENANT_ID },
        { settings: { version: 1, region: { timezone: 'Asia/Dhaka' }, ...extra } as any },
      );
  }

  async function makeSection(tenantId: string, year: string, name: string) {
    const klass = await dataSource
      .getRepository(Class)
      .save({ name: `Cmt ${name}`, academic_year_id: year, tenant_id: tenantId });
    const section = await dataSource
      .getRepository(ClassSection)
      .save({ section_name: name, class_id: klass.id, tenant_id: tenantId });
    return section.id;
  }

  /** One register with one fresh student per status; returns the student ids. */
  async function mark(
    sectionId: string,
    date: string,
    statuses: AttendanceStatus[],
    opts: { periodNo?: number | null; state?: AttendanceSessionState; tenantId?: string } = {},
  ) {
    const tenantId = opts.tenantId ?? TENANT_ID;
    const session = await dataSource.getRepository(AttendanceSession).save({
      tenant_id: tenantId,
      section_id: sectionId,
      date,
      period_no: opts.periodNo ?? null,
      state: opts.state ?? AttendanceSessionState.FINALIZED,
    });
    const ids: string[] = [];
    for (const status of statuses) {
      n += 1;
      const student = await dataSource.getRepository(Student).save({
        full_name: `Cmt Student ${n}`,
        registration_number: `CMT-REG-${n}-${Date.now()}`,
        roll_number: n,
        class_section_id: sectionId,
        tenant_id: tenantId,
      });
      await enrollStudent(dataSource, student);
      await dataSource.getRepository(AttendanceRecord).save({
        tenant_id: tenantId,
        session_id: session.id,
        student_id: student.id,
        date,
        status,
      });
      ids.push(student.id);
    }
    return ids;
  }

  async function clearCaches() {
    const keys = [
      ...(await redis.keys(
        `tenant:${TENANT_ID}:dash:v1:${DashboardWidgetKey.COMMITTEE_ATTENDANCE}:*`,
      )),
      ...(await redis.keys(`tenant:${TENANT_ID}:dash:v1:${DashboardWidgetKey.ATTENDANCE_TODAY}:*`)),
    ];
    if (keys.length) await redis.del(...keys);
  }

  const widget = async () => {
    await clearCaches();
    return service.getCommitteeMonthly(TENANT_ID);
  };
  const pct = (w: { months: { month: string; percentage: number | null }[] }, month: string) =>
    w.months.find((m) => m.month === month)?.percentage;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), AttendanceModule, AuthModule],
    );
    service = module.get(AttendanceDashboardService);
    dataSource = module.get<DataSource>(getDataSourceToken());
    redis = module.get(TENANT_STATUS_REDIS);

    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: OTHER_TENANT } }))) {
      await schoolRepo.save({ id: OTHER_TENANT, name: 'Cmt Other', slug: 'cmt-other' });
    }
    const yearRepo = dataSource.getRepository(AcademicYear);
    await yearRepo.update({ tenant_id: TENANT_ID }, { is_current: false });
    const year = await yearRepo.save({
      name: 'Cmt Year',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      is_current: true,
      tenant_id: TENANT_ID,
    });
    yearId = year.id;
    const oldYear = await yearRepo.save({
      name: 'Cmt Old Year',
      start_date: '2025-01-01',
      end_date: '2025-12-31',
      tenant_id: TENANT_ID,
    });
    sec = await makeSection(TENANT_ID, yearId, 'CmtA');
    oldYearSec = await makeSection(TENANT_ID, oldYear.id, 'CmtOld');
    const otherYear = await yearRepo.save({
      name: 'Cmt Other Year',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      is_current: true,
      tenant_id: OTHER_TENANT,
    });
    otherSec = await makeSection(OTHER_TENANT, otherYear.id, 'CmtX');
  }, 60000);

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) });
    await setSettings();
    await dataSource.query(
      `DELETE FROM attendance_records WHERE student_id IN (SELECT id FROM students WHERE full_name LIKE 'Cmt Student%')`,
    );
    await dataSource.query(`DELETE FROM attendance_sessions WHERE section_id IN ($1,$2,$3)`, [
      sec,
      oldYearSec,
      otherSec,
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await clearCaches();
    await dataSource?.destroy();
  });

  it('gives the exact % per month and lists every month from the year start to this month', async () => {
    await mark(sec, '2026-03-10', [P, P, A, A]); // 50 %
    await mark(sec, '2026-10-05', [P, P, P, A]); // 75 %
    const w = await widget();
    expect(w.months.map((m) => m.month)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(pct(w, '2026-03')).toBe(50);
    expect(pct(w, '2026-10')).toBe(75);
    expect(w.current_month_percentage).toBe(75);
  });

  it('follows lateCountsAsPresent exactly as computeAttendancePercentage does', async () => {
    await mark(sec, '2026-03-10', [P, L, A, V]);
    const counts = {
      present_days: 1,
      late_days: 1,
      absent_days: 1,
      leave_days: 1,
      working_days: 4,
      marked_days: 4,
    };
    for (const lateCountsAsPresent of [true, false]) {
      await setSettings({ attendance: { lateCountsAsPresent } });
      const w = await widget();
      expect(pct(w, '2026-03')).toBe(
        computeAttendancePercentage(counts, { lateCountsAsPresent } as any),
      );
    }
  });

  it('ignores period registers, DRAFT registers, last-year sections and students off the roll', async () => {
    await mark(sec, '2026-03-10', [P, A]); // the only thing that should count: 50 %
    await mark(sec, '2026-03-11', [A, A, A], { periodNo: 2 });
    await mark(sec, '2026-03-12', [A, A, A], { state: AttendanceSessionState.DRAFT });
    await mark(oldYearSec, '2026-03-13', [A, A, A]);
    // Left before the register date, and an ended enrollment with no leaving event: off the roll.
    const [gone] = await mark(sec, '2026-03-14', [A]);
    await dataSource.query(
      `UPDATE enrollments SET enrollment_status = 'INACTIVE' WHERE student_id = $1`,
      [gone],
    );
    expect(pct(await widget(), '2026-03')).toBe(50);
  });

  it('counts a student who left AFTER the register date, as recorded', async () => {
    const ids = await mark(sec, '2026-03-10', [P, A]);
    // Rahim (ids[1]) left on 1 August: on the roll in March.
    await dataSource.query(
      `UPDATE enrollments SET enrollment_status = 'INACTIVE' WHERE student_id = $1`,
      [ids[1]],
    );
    await dataSource.query(
      `INSERT INTO student_lifecycle_events (tenant_id, student_id, enrollment_id, academic_year_id, event_type, occurred_on, reason)
       SELECT e.tenant_id, e.student_id, e.id, e.academic_year_id, 'WITHDRAWN', '2026-08-01', 'moved'
       FROM enrollments e WHERE e.student_id = $1`,
      [ids[1]],
    );
    expect(pct(await widget(), '2026-03')).toBe(50);
  });

  it('a month with no registers is null and year_percentage comes from summed counts', async () => {
    await mark(sec, '2026-03-10', [P]); // 1 of 1
    await mark(sec, '2026-04-10', [P, A, A]); // 1 of 3
    const w = await widget();
    expect(pct(w, '2026-02')).toBeNull();
    // Sum: 2 present of 4 marked = 50, a mean of months (100, 33.3) would say 66.7.
    expect(w.year_percentage).toBe(50);
  });

  it('matches the 30-day series point for a day inside the window', async () => {
    await mark(sec, '2026-10-10', [P, P, L, A]);
    await clearCaches();
    const series = await service.computeSeries(TENANT_ID, '2026-10-20');
    const point = series.find((p) => p.date === '2026-10-10')?.percentage;
    expect(point).not.toBeNull();
    expect(pct(await widget(), '2026-10')).toBe(point);
  });

  it('rolls over at Dhaka midnight: 00:30 on 1 Nov is November', async () => {
    vi.setSystemTime(new Date('2026-10-31T18:30:00Z'));
    const w = await widget();
    expect(w.months[w.months.length - 1].month).toBe('2026-11');
  });

  it('keeps the last Dhaka day in October one minute before midnight', async () => {
    vi.setSystemTime(new Date('2026-10-31T17:59:00Z'));
    const w = await widget();
    expect(w.months[w.months.length - 1].month).toBe('2026-10');
  });

  it("never lets another school's registers change this school's numbers", async () => {
    await mark(sec, '2026-03-10', [P, A]);
    const before = await widget();
    await mark(otherSec, '2026-03-10', [A, A, A, A], { tenantId: OTHER_TENANT });
    expect(await widget()).toEqual(before);
  });

  it('target follows the saved setting, and defaults to 90', async () => {
    expect((await widget()).target_percentage).toBe(90);
    await setSettings({ dashboard: { committeeAttendanceTargetPct: 92 } });
    expect((await widget()).target_percentage).toBe(92);
  });

  it('with no current academic year: no months, all percentages null', async () => {
    await dataSource.getRepository(AcademicYear).update({ id: yearId }, { is_current: false });
    try {
      const w = await widget();
      expect(w).toMatchObject({
        months: [],
        current_month_percentage: null,
        year_percentage: null,
      });
    } finally {
      await dataSource.getRepository(AcademicYear).update({ id: yearId }, { is_current: true });
    }
  });
});
