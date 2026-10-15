import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import {
  AttendanceSessionState,
  AttendanceStatus,
  DashboardWidgetKey,
  UserRole,
} from '@biddaloy/shared';
import { AttendanceModule } from './attendance.module';
import { AuthModule } from '../auth/auth.module';
import { AttendanceDashboardService } from './attendance-dashboard.service';
import { AttendanceService } from './attendance.service';
import { computeAttendancePercentage } from './attendance-summary.service';
import { AttendanceSession } from './entities/attendance-session.entity';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { CalendarEvent } from '../calendar/entities/calendar-event.entity';
import { CalendarEventClass } from '../calendar/entities/calendar-event-class.entity';
import { TENANT_STATUS_REDIS } from '../schools/tenant-status.service';
import { enrollStudent } from '@test/helpers/enrollment.helper';

/**
 * [8.10.7.2.01] The widget must agree with `GET /attendance/my-sections` for a
 * tenant-wide caller. Other fixtures in the shared seed tenant can add sections,
 * so assertions about "my" sections filter by id; totals are compared with
 * `listMySections` itself.
 */
describe('AttendanceDashboardService (integration)', () => {
  let service: AttendanceDashboardService;
  let attendance: AttendanceService;
  let dataSource: DataSource;
  let redis: Redis;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000098';
  let yearId: string;
  let secA: { id: string; classId: string };
  let secB: { id: string; classId: string };
  let otherSectionId: string;
  let n = 0;

  const isoOffset = (date: string, days: number) => {
    const d = new Date(`${date}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  async function setSettings(tenantId: string, attendance: object = { weeklyOffDays: [] }) {
    await dataSource.getRepository(School).update(
      { id: tenantId },
      {
        settings: { version: 1, region: { timezone: 'Asia/Dhaka' }, attendance } as any,
      },
    );
  }

  async function makeSection(tenantId: string, year: string, name: string) {
    const klass = await dataSource
      .getRepository(Class)
      .save({ name: `Dash ${name}`, academic_year_id: year, tenant_id: tenantId });
    const section = await dataSource
      .getRepository(ClassSection)
      .save({ section_name: name, class_id: klass.id, tenant_id: tenantId });
    return { id: section.id, classId: klass.id };
  }

  async function mark(
    tenantId: string,
    sectionId: string,
    date: string,
    statuses: AttendanceStatus[],
    opts: { periodNo?: number | null; state?: AttendanceSessionState } = {},
  ) {
    const session = await dataSource.getRepository(AttendanceSession).save({
      tenant_id: tenantId,
      section_id: sectionId,
      date,
      period_no: opts.periodNo ?? null,
      state: opts.state ?? AttendanceSessionState.FINALIZED,
    });
    for (const status of statuses) {
      n += 1;
      const student = await dataSource.getRepository(Student).save({
        full_name: `Dash Student ${n}`,
        registration_number: `DASH-REG-${n}-${Date.now()}`,
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
    }
  }

  const P = AttendanceStatus.PRESENT;
  const L = AttendanceStatus.LATE;
  const A = AttendanceStatus.ABSENT;

  const widget = () => service.getToday(TENANT_ID, UserRole.ADMIN, SEED_ADMIN_USER_ID);

  async function clearCaches() {
    const keys = await redis.keys(
      `tenant:${TENANT_ID}:dash:${DashboardWidgetKey.ATTENDANCE_TODAY}:*`,
    );
    if (keys.length) await redis.del(...keys);
  }

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), AttendanceModule, AuthModule],
    );
    service = module.get(AttendanceDashboardService);
    attendance = module.get(AttendanceService);
    dataSource = module.get<DataSource>(getDataSourceToken());
    redis = module.get(TENANT_STATUS_REDIS);

    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: OTHER_TENANT } }))) {
      await schoolRepo.save({ id: OTHER_TENANT, name: 'Dash Other', slug: 'dash-other' });
    }
    const yearRepo = dataSource.getRepository(AcademicYear);
    await yearRepo.update({ tenant_id: TENANT_ID }, { is_current: false });
    const year = await yearRepo.save({
      name: 'Dash Year',
      start_date: '2026-01-01',
      end_date: '2030-12-31',
      is_current: true,
      tenant_id: TENANT_ID,
    });
    yearId = year.id;
    secA = await makeSection(TENANT_ID, yearId, 'DashA');
    secB = await makeSection(TENANT_ID, yearId, 'DashB');
    const otherYear = await yearRepo.save({
      name: 'Dash Other Year',
      start_date: '2026-01-01',
      end_date: '2030-12-31',
      tenant_id: OTHER_TENANT,
    });
    otherSectionId = (await makeSection(OTHER_TENANT, otherYear.id, 'DashX')).id;
  }, 60000);

  beforeEach(async () => {
    await setSettings(TENANT_ID);
    await clearCaches();
    // Fresh registers each test: drop only what these specs wrote.
    await dataSource.query(
      `DELETE FROM attendance_records WHERE student_id IN (SELECT id FROM students WHERE full_name LIKE 'Dash Student%')`,
    );
    await dataSource.query(`DELETE FROM attendance_sessions WHERE section_id IN ($1,$2,$3)`, [
      secA.id,
      secB.id,
      otherSectionId,
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await clearCaches();
    await dataSource?.destroy();
  });

  // Reads the date, then drops the cache that read left behind.
  const today = async () => {
    const { date } = await widget();
    await clearCaches();
    return date;
  };

  it('lists exactly the section with no finalised register as pending, and uses the policy formula', async () => {
    const date = await today();
    await mark(TENANT_ID, secA.id, date, [P, P, P, L, A]); // finalised: 3 present, 1 late, 1 absent
    await clearCaches();
    const w = await widget();

    const mine = w.pending_sections.filter((s) => [secA.id, secB.id].includes(s.section_id));
    expect(mine.map((s) => s.section_id)).toEqual([secB.id]);

    // Compared with the same formula over the summed counts the widget reports.
    const marked = w.counts.present + w.counts.late + w.counts.absent + w.counts.leave;
    expect(w.percentage).toBe(
      computeAttendancePercentage(
        {
          present_days: w.counts.present,
          late_days: w.counts.late,
          absent_days: w.counts.absent,
          leave_days: w.counts.leave,
          working_days: marked,
          marked_days: marked,
        },
        {
          percentageDenominator: 'WORKING_DAYS',
          leaveCountsAsWorkingDay: true,
          lateCountsAsPresent: true,
        },
      ),
    );
    expect(w.counts.present).toBeGreaterThanOrEqual(3);
    expect(w.series).toHaveLength(30);
    expect(w.series[29]).toEqual({ date, percentage: w.percentage });
  });

  it('reconciles with listMySections for a tenant-wide caller', async () => {
    const date = await today();
    await mark(TENANT_ID, secA.id, date, [P, P, A]);
    await mark(TENANT_ID, secB.id, date, [P, L], { state: AttendanceSessionState.DRAFT });
    await clearCaches();
    const w = await widget();
    const rows = await attendance.listMySections({
      role: UserRole.ADMIN,
      userId: SEED_ADMIN_USER_ID,
      tenantId: TENANT_ID,
      date,
    });
    const sum = (k: 'present' | 'late' | 'absent' | 'leave' | 'unmarked') =>
      rows.reduce((t, r) => t + (r.today?.[k] ?? 0), 0);
    expect(w.counts).toEqual({
      present: sum('present'),
      late: sum('late'),
      absent: sum('absent'),
      leave: sum('leave'),
      unmarked: sum('unmarked'),
    });
    expect(w.sections_total).toBe(rows.length);
    // A DRAFT register is not "done".
    expect(w.pending_sections.map((s) => s.section_id)).toContain(secB.id);
  });

  it('does not count a period register on the same day', async () => {
    const date = await today();
    await mark(TENANT_ID, secA.id, date, [P, P], { periodNo: 2 });
    await clearCaches();
    const w = await widget();
    expect(w.pending_sections.map((s) => s.section_id)).toContain(secA.id);
    const point = (await service.computeSeries(TENANT_ID, date)).at(-1)!;
    expect(point.percentage).toBeNull(); // only a period register exists for today in my sections
  });

  it('a class-scoped holiday makes that section non-working and not pending', async () => {
    const date = await today();
    const event = await dataSource.getRepository(CalendarEvent).save({
      tenant_id: TENANT_ID,
      academic_year_id: yearId,
      start_date: date,
      end_date: date,
      name: 'Dash Break',
      counts_as_working_day: false,
      published_at: new Date(),
    });
    await dataSource
      .getRepository(CalendarEventClass)
      .save({ event_id: event.id, class_id: secA.classId, tenant_id: TENANT_ID });
    try {
      const w = await widget();
      const ids = w.pending_sections.map((s) => s.section_id);
      expect(ids).not.toContain(secA.id);
      expect(ids).toContain(secB.id);
    } finally {
      await dataSource.getRepository(CalendarEventClass).delete({ event_id: event.id });
      await dataSource.getRepository(CalendarEvent).delete({ id: event.id });
    }
  });

  it('series: day -1 and day -8 are points, the rest null; week_ago is the day -7 point', async () => {
    const date = await today();
    await mark(TENANT_ID, secA.id, isoOffset(date, -1), [P, A]);
    await mark(TENANT_ID, secA.id, isoOffset(date, -8), [P, P, P, A]);
    await clearCaches();
    const w = await widget();
    expect(w.series).toHaveLength(30);
    const byDate = new Map(w.series.map((p) => [p.date, p.percentage]));
    expect(byDate.get(isoOffset(date, -1))).not.toBeNull();
    expect(byDate.get(isoOffset(date, -8))).not.toBeNull();
    expect(byDate.get(isoOffset(date, -7))).toBeNull();
    expect(w.week_ago_percentage).toBeNull();
    // Day -8 had 3 of 4 present across my sections (and nothing else in the seed tenant).
    expect(byDate.get(isoOffset(date, -8))).toBeGreaterThan(0);
  });

  it('serves yesterday from the nightly key rather than recomputing', async () => {
    const date = await today();
    const key = service.seriesKey(TENANT_ID, isoOffset(date, -1));
    const fake = Array.from({ length: 30 }, (_, i) => ({
      date: isoOffset(date, -30 + i),
      percentage: 77,
    }));
    await redis.set(key, JSON.stringify(fake), 'EX', 60);
    const w = await widget();
    expect(w.week_ago_percentage).toBe(77);
    expect(w.series[28].percentage).toBe(77);
  });

  it('Dhaka midnight: 17:59Z is still 7 Oct, 18:00Z is 8 Oct', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T17:59:00Z'));
    expect((await widget()).date).toBe('2026-10-07');
    await clearCaches();
    vi.setSystemTime(new Date('2026-10-07T18:00:00Z'));
    expect((await widget()).date).toBe('2026-10-08');
  });

  it("another tenant's records never change this tenant's counts", async () => {
    const date = await today();
    const before = (await widget()).counts;
    await mark(OTHER_TENANT, otherSectionId, date, [P, P, P, A]);
    await clearCaches();
    expect((await widget()).counts).toEqual(before);
    const series = await service.computeSeries(TENANT_ID, date);
    expect(series.at(-1)!.percentage).toBeNull();
  });
});
