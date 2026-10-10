/* eslint-disable no-console */
import { performance } from 'perf_hooks';
import * as os from 'os';
import { execSync } from 'child_process';
import type { DataSource } from 'typeorm';
import { AlertCadence, UserRole } from '@biddaloy/shared';
import { createScriptAppContext } from './script-app-context';

/**
 * [67.6.04] Manual performance check of the attention engine on one big school.
 * Run by hand, never in CI. Needs a throwaway database whose name ends in `_perf`
 * that already ran `yarn seed` (see docs/architecture/23-attention.md, Performance).
 *
 *   yarn workspace @biddaloy/server perf:attention --confirm-db=<name>_perf
 *
 * Seeds 10,000 students into the default school (set-based SQL), then times the
 * FAST / HOURLY / DAILY sweeps, `GET /attention/summary` at service level, and the
 * hourly cross-school scan of `platform.provider_failures`.
 */
const USAGE = 'usage: perf:attention --confirm-db=<current database name, ending in _perf>';
const SUFFIX = '_perf';
const MARKER_SECTION = 'PERF-01';
const SWEEP_RUNS = 5;
const SUMMARY_USERS = 200;
const LOG_ROWS = 500_000;

/** Returns an error message unless `--confirm-db=<name>` names the connected `_perf` database. */
export function perfGuardError(argv: string[], currentDatabase: string): string | null {
  const arg = argv.find((a) => a.startsWith('--confirm-db='));
  const confirmed = arg?.slice('--confirm-db='.length);
  if (!confirmed) return `refusing to run: missing --confirm-db. ${USAGE}`;
  if (confirmed !== currentDatabase)
    return `refusing to run: connected database is "${currentDatabase}", not "${confirmed}".`;
  if (!currentDatabase.endsWith(SUFFIX))
    return `refusing to run: "${currentDatabase}" does not end in "${SUFFIX}". Never point this at a shared or production database.`;
  return null;
}

/** Nearest-rank percentile (p in 0..100) of a list of numbers. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

const ms = (n: number) => `${n.toFixed(1)} ms`;

async function seedBigSchool(db: DataSource, tenantId: string, day: string): Promise<boolean> {
  const [{ n }] = await db.query(
    `SELECT count(*)::int AS n FROM class_sections WHERE tenant_id = $1 AND section_name = $2`,
    [tenantId, MARKER_SECTION],
  );
  if (n > 0) {
    console.log(`seed: marker section ${MARKER_SECTION} exists, skipping the seed`);
    return false;
  }
  await db.transaction(async (em) => {
    const run = async (label: string, sql: string) => {
      // Postgres rejects parameters the statement never mentions, so pass only $1..$max.
      const max = Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
      const t0 = performance.now();
      await em.query(sql, [tenantId, day].slice(0, max));
      console.log(`seed: ${label} ${ms(performance.now() - t0)}`);
    };
    // 10 classes x 4 sections, on the current year and the seed shift.
    await run(
      'classes',
      `INSERT INTO classes (tenant_id, name, numeric_grade, academic_year_id, shift_id)
       SELECT $1, 'PERF Class ' || lpad(n::text, 2, '0'), n,
              (SELECT id FROM academic_years WHERE tenant_id = $1 AND is_current = true AND deleted_at IS NULL LIMIT 1),
              (SELECT id FROM shifts WHERE tenant_id = $1 LIMIT 1)
         FROM generate_series(1, 10) n`,
    );
    await run(
      'sections',
      `INSERT INTO class_sections (tenant_id, class_id, section_name, capacity)
       SELECT $1, c.id, 'PERF-' || lpad((((split_part(c.name, ' ', 3))::int - 1) * 4 + s)::text, 2, '0'), 300
         FROM classes c CROSS JOIN generate_series(1, 4) s
        WHERE c.tenant_id = $1 AND c.name LIKE 'PERF Class %'`,
    );
    // 40 class teachers (users -> memberships -> staff profiles -> teachers).
    await run(
      'teacher users',
      `INSERT INTO users (email, full_name, status)
       SELECT 'perf-t' || n || '@perf.invalid', 'Perf Teacher ' || n, 'ACTIVE' FROM generate_series(1, 40) n`,
    );
    await run(
      'teacher memberships',
      `INSERT INTO user_tenants (user_id, tenant_id, role)
       SELECT u.id, $1, 'TEACHER' FROM users u WHERE u.email LIKE 'perf-t%@perf.invalid'`,
    );
    await run(
      'staff profiles',
      `INSERT INTO staff_profiles (user_id, tenant_id, employee_id, joining_date)
       SELECT u.id, $1, 'PERF-T' || substring(u.email from 7 for position('@' in u.email) - 7), '2020-01-01'
         FROM users u WHERE u.email LIKE 'perf-t%@perf.invalid'`,
    );
    await run(
      'teachers',
      `INSERT INTO teachers (user_id, employee_id, tenant_id, staff_profile_id)
       SELECT sp.user_id, sp.employee_id, $1, sp.id FROM staff_profiles sp
        WHERE sp.tenant_id = $1 AND sp.employee_id LIKE 'PERF-T%'`,
    );
    await run(
      'class teachers',
      `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, assignment_type)
       SELECT t.id, cs.id, $1, 'CLASS_TEACHER'
         FROM class_sections cs
         JOIN teachers t ON t.tenant_id = $1 AND t.employee_id = 'PERF-T' || ltrim(substring(cs.section_name from 6), '0')
        WHERE cs.tenant_id = $1 AND cs.section_name LIKE 'PERF-%'`,
    );
    await run(
      'subject teachers',
      `INSERT INTO teacher_class_sections (teacher_id, section_id, subject_id, tenant_id, assignment_type)
       SELECT t.id, cs.id, s.id, $1, 'SUBJECT_TEACHER'
         FROM class_sections cs
         CROSS JOIN (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM subjects WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 6) s
         JOIN teachers t ON t.tenant_id = $1
          AND t.employee_id = 'PERF-T' || (((ltrim(substring(cs.section_name from 6), '0'))::int + s.rn) % 40 + 1)
        WHERE cs.tenant_id = $1 AND cs.section_name LIKE 'PERF-%'`,
    );
    // Every weekday, every CLASS period, a rotating subject: a published routine for each new section.
    await run(
      'routine slots',
      `INSERT INTO routine_slots (tenant_id, routine_id, section_id, period_slot_id, weekday, subject_id, recurrence, valid_from)
       SELECT $1, (SELECT id FROM routines WHERE tenant_id = $1 AND state = 'PUBLISHED' AND deleted_at IS NULL LIMIT 1),
              cs.id, p.id, w, s.id, 'WEEKLY', '2020-01-01'
         FROM class_sections cs
         CROSS JOIN generate_series(0, 6) w
         JOIN period_slots p ON p.tenant_id = $1 AND p.kind = 'CLASS'
         JOIN (SELECT id, (row_number() OVER (ORDER BY id) - 1) AS rn FROM subjects WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 6) s
           ON s.rn = (p.sequence + w) % 6
        WHERE cs.tenant_id = $1 AND cs.section_name LIKE 'PERF-%'`,
    );
    // 250 students per section.
    await run(
      'students',
      `INSERT INTO students (tenant_id, full_name, registration_number, roll_number, class_section_id, enrollment_status)
       SELECT $1, 'Perf Student ' || n, 'PERF-S' || n, j, cs.id, 'ACTIVE'
         FROM class_sections cs
         CROSS JOIN generate_series(1, 250) j
         CROSS JOIN LATERAL (SELECT ((substring(cs.section_name from 6))::int - 1) * 250 + j AS n) x(n)
        WHERE cs.tenant_id = $1 AND cs.section_name LIKE 'PERF-%'`,
    );
    // 15,000 guardians, half with a login.
    await run(
      'guardian users',
      `INSERT INTO users (email, full_name, status)
       SELECT 'perf-g' || n || '@perf.invalid', 'Perf Guardian ' || n, 'ACTIVE' FROM generate_series(2, 15000, 2) n`,
    );
    await run(
      'guardian memberships',
      `INSERT INTO user_tenants (user_id, tenant_id, role)
       SELECT u.id, $1, 'PARENT' FROM users u WHERE u.email LIKE 'perf-g%@perf.invalid'`,
    );
    await run(
      'guardians',
      `INSERT INTO guardians (tenant_id, user_id, full_name, relationship, phone, is_primary_contact, notifications_enabled)
       SELECT $1, u.id, 'Perf Guardian ' || n, 'Father', '017' || lpad(n::text, 8, '0'), n <= 10000, true
         FROM generate_series(1, 15000) n
         LEFT JOIN users u ON u.email = 'perf-g' || n || '@perf.invalid'`,
    );
    await run(
      'student guardians',
      `INSERT INTO student_guardians (student_id, guardian_id)
       SELECT st.id, g.id FROM (
         SELECT s.id, (substring(s.registration_number from 7))::int AS n FROM students s
          WHERE s.tenant_id = $1 AND s.registration_number LIKE 'PERF-S%') st
       JOIN guardians g ON g.tenant_id = $1 AND g.phone IN (
              '017' || lpad(st.n::text, 8, '0'),
              CASE WHEN st.n <= 5000 THEN '017' || lpad((st.n + 10000)::text, 8, '0') END)`,
    );
    // Today: half the sections finalised a day register (with 5 % absent), half have none.
    await run(
      'attendance sessions',
      `INSERT INTO attendance_sessions (tenant_id, section_id, date, state, source, finalized_at)
       SELECT $1, cs.id, $2::date, 'FINALIZED', 'TEACHER', now()
         FROM class_sections cs
        WHERE cs.tenant_id = $1 AND cs.section_name LIKE 'PERF-%'
          AND (substring(cs.section_name from 6))::int % 2 = 0`,
    );
    await run(
      'attendance records',
      `INSERT INTO attendance_records (tenant_id, session_id, student_id, date, status)
       SELECT $1, a.id, st.id, $2::date, CASE WHEN st.roll_number % 20 = 0 THEN 'ABSENT' ELSE 'PRESENT' END::attendance_status_enum
         FROM attendance_sessions a JOIN students st ON st.class_section_id = a.section_id
        WHERE a.tenant_id = $1 AND a.date = $2::date AND st.tenant_id = $1 AND st.registration_number LIKE 'PERF-S%'`,
    );
    // 200 homework assignments due today (5 per section), 30 % not submitted.
    await run(
      'homework',
      `INSERT INTO homework (tenant_id, subject_id, class_id, title, grading_mode)
       SELECT $1, (SELECT id FROM subjects WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY id LIMIT 1),
              cs.class_id, 'PERF HW ' || cs.section_name || '-' || i, 'TICK'
         FROM class_sections cs CROSS JOIN generate_series(1, 5) i
        WHERE cs.tenant_id = $1 AND cs.section_name LIKE 'PERF-%'`,
    );
    await run(
      'homework assignments',
      `INSERT INTO homework_assignments (tenant_id, homework_id, section_id, assigned_date, due_date, status)
       SELECT $1, h.id, cs.id, $2::date - 1, $2::date, 'ACTIVE'
         FROM homework h JOIN class_sections cs ON cs.tenant_id = $1 AND cs.class_id = h.class_id
          AND h.title LIKE 'PERF HW ' || cs.section_name || '-%'
        WHERE h.tenant_id = $1`,
    );
    await run(
      'homework submissions',
      `INSERT INTO homework_submissions (tenant_id, assignment_id, student_id, status)
       SELECT $1, ha.id, st.id, CASE WHEN st.roll_number % 10 < 3 THEN 'NOT_SUBMITTED' ELSE 'DONE' END::homework_submissions_status_enum
         FROM homework_assignments ha JOIN students st ON st.class_section_id = ha.section_id
        WHERE ha.tenant_id = $1 AND ha.due_date = $2::date AND st.tenant_id = $1 AND st.registration_number LIKE 'PERF-S%'`,
    );
    // Overdue fees for 10 % of students.
    await run(
      'overdue fees',
      `INSERT INTO student_fees (student_id, academic_year_id, total_amount, paid_amount, status, due_date, fee_structure_id,
                                 period_start, period_type)
       SELECT st.id, (SELECT id FROM academic_years WHERE tenant_id = $1 AND is_current = true AND deleted_at IS NULL LIMIT 1),
              1000, 0, 'OVERDUE', $2::date - 10, (SELECT id FROM fee_structures WHERE tenant_id = $1 LIMIT 1),
              $2::date - 40, 'MONTH'
         FROM students st WHERE st.tenant_id = $1 AND st.registration_number LIKE 'PERF-S%' AND st.roll_number % 10 = 0`,
    );
    // Message history for the cross-school scan: ~2 % FAILED over 90 days, plus an incident in the last hour.
    await run(
      'communication logs',
      `INSERT INTO communication_logs (tenant_id, medium, recipient_address, recipient_name, message_body, subject, status, trigger, created_at, updated_at)
       SELECT s.id,
              'SMS', '017' || lpad((n % 100000)::text, 8, '0'), 'Perf', 'perf message', 'Perf',
              CASE WHEN n % 50 = 0 THEN 'FAILED' ELSE 'SENT' END::communication_logs_status_enum, 'AUTOMATED',
              now() - (n % 90) * interval '1 day' - (n % 1440) * interval '1 minute',
              now() - (n % 90) * interval '1 day' - (n % 1440) * interval '1 minute'
         FROM generate_series(1, ${LOG_ROWS}) n
         JOIN (SELECT id, row_number() OVER (ORDER BY id) - 1 AS rn, count(*) OVER () AS c FROM schools) s
           ON s.rn = n % s.c`,
    );
    await run(
      'recent failures',
      `INSERT INTO communication_logs (tenant_id, medium, recipient_address, recipient_name, message_body, subject, status, trigger)
       SELECT $1, 'SMS', '0170000000' || n, 'Perf', 'perf incident', 'Perf', 'FAILED', 'AUTOMATED' FROM generate_series(1, 60) n`,
    );
  });
  return true;
}

export async function main(argv: string[]): Promise<number> {
  if (process.env.NODE_ENV === 'production') {
    console.error('refusing to run with NODE_ENV=production');
    return 2;
  }
  const app = await createScriptAppContext();
  try {
    const { DataSource: DS } = await import('typeorm');
    const { AttentionScheduler } = await import('../modules/attention/engine/attention-scheduler');
    const { AttentionQueryService } =
      await import('../modules/attention/api/attention-query.service');
    const { RuleContextService, localDateTimeToUtc, addDaysIso } =
      await import('../modules/attention/rules/rule-context.service');
    const { RuleRegistryService } =
      await import('../modules/attention/rules/rule-registry.service');
    const { attentionKeys } = await import('../modules/attention/attention.constants');
    const { TENANT_STATUS_REDIS } = await import('../modules/schools/tenant-status.service');
    const db = app.get(DS);
    const [{ current_database, version }] = await db.query(
      'SELECT current_database(), version() AS version',
    );
    const guard = perfGuardError(argv, current_database);
    if (guard) {
      console.error(guard);
      return 2;
    }

    const [school] = await db.query(`SELECT id FROM schools WHERE name = 'Default School' LIMIT 1`);
    if (!school) {
      console.error('Default School not found: run `yarn seed` on this database first.');
      return 2;
    }
    const tenantId: string = school.id;
    const scheduler = app.get(AttentionScheduler, { strict: false });
    const query = app.get(AttentionQueryService, { strict: false });
    const context = app.get(RuleContextService, { strict: false });
    const registry = app.get(RuleRegistryService, { strict: false });
    const redis = app.get(TENANT_STATUS_REDIS, { strict: false });

    // The simulated "today": the next working day, at 09:30 (inside school hours).
    let day = new Date().toISOString().slice(0, 10);
    let fastNow = new Date();
    for (let i = 0; i < 14; i++) {
      const tz = (await context.build(tenantId, new Date())).tz;
      fastNow = localDateTimeToUtc(day, '09:30', tz);
      const ctx = await context.build(tenantId, fastNow);
      if (ctx.isWorkingDay && (await context.isWithinSchoolHours(ctx))) break;
      day = addDaysIso(day, 1);
    }
    const dailyNow = localDateTimeToUtc(day, '17:30', (await context.build(tenantId, fastNow)).tz);
    console.log(`perf: tenant=${tenantId} simulated day=${day} database=${current_database}`);

    await seedBigSchool(db, tenantId, day);
    const [counts] = await db.query(
      `SELECT (SELECT count(*)::int FROM students WHERE tenant_id = $1 AND deleted_at IS NULL) AS students,
              (SELECT count(*)::int FROM class_sections WHERE tenant_id = $1 AND deleted_at IS NULL) AS sections,
              (SELECT count(*)::int FROM communication_logs) AS logs`,
      [tenantId],
    );
    console.log(
      `perf: students=${counts.students} sections=${counts.sections} communication_logs=${counts.logs}`,
    );
    await db.query('ANALYZE');

    // 1. Sweeps. Run 1 writes alerts; later runs are the steady "nothing changed" path (D7).
    const sweepRows: string[] = [];
    for (const [cadence, now] of [
      [AlertCadence.FAST, fastNow],
      [AlertCadence.HOURLY, fastNow],
      [AlertCadence.DAILY, dailyNow],
    ] as const) {
      const times: number[] = [];
      for (let i = 0; i < SWEEP_RUNS; i++) {
        if (cadence === AlertCadence.DAILY) {
          const stale = await redis.keys(`tenant:${tenantId}:attention:daily:*`);
          if (stale.length) await redis.del(...stale);
        }
        const t0 = performance.now();
        await scheduler.sweepTenant(tenantId, cadence, now);
        times.push(performance.now() - t0);
      }
      console.log(`perf: ${cadence} runs: ${times.map((t) => t.toFixed(0)).join(', ')} ms`);
      const steady = times.slice(1);
      sweepRows.push(
        `| ${cadence} sweep, one school (first run writes) | ${ms(times[0])} | ${ms(percentile(steady, 50))} | ${ms(Math.max(...steady))} |`,
      );
    }

    // Slowest rules, one evaluate each, at the same clock as the sweep.
    for (const [cadence, now] of [
      [AlertCadence.FAST, fastNow],
      [AlertCadence.HOURLY, fastNow],
      [AlertCadence.DAILY, dailyNow],
    ] as const) {
      const ctx = await context.build(tenantId, now);
      const timed: [string, number][] = [];
      for (const rule of registry.forCadence(cadence)) {
        const t0 = performance.now();
        await rule.evaluate(ctx).catch(() => []);
        timed.push([rule.meta.key, performance.now() - t0]);
      }
      timed.sort((a, b) => b[1] - a[1]);
      console.log(
        `perf: slowest ${cadence} rules: ${timed
          .slice(0, 5)
          .map(([k, t]) => `${k}=${t.toFixed(0)}ms`)
          .join(', ')}`,
      );
    }
    // Proof the rules really fired on this data (an empty sweep would be fast for the wrong reason).
    const fired: { rule_key: string; alerts: number; recipients: number }[] = await db.query(
      `SELECT a.rule_key, count(DISTINCT a.id)::int AS alerts, count(r.id)::int AS recipients
         FROM alerts a LEFT JOIN alert_recipients r ON r.alert_id = a.id AND r.tenant_id = a.tenant_id
        WHERE a.tenant_id = $1 AND a.status = 'ACTIVE' GROUP BY a.rule_key ORDER BY a.rule_key`,
      [tenantId],
    );
    console.log(
      `perf: active alerts/recipients after the sweeps: ${fired
        .map((f) => `${f.rule_key}=${f.alerts}/${f.recipients}`)
        .join(', ')}`,
    );
    const failing = await redis.keys('attention:failing:*');
    console.log(`perf: failing-rule keys in Redis after the sweeps: ${failing.length}`);
    for (const key of failing)
      console.log(`perf:   ${key} ${JSON.stringify(await redis.hgetall(key))}`);

    // 2. Summary at service level, cold then warm, for a mix of recipients.
    const recipients: { user_id: string; role: string }[] = await db.query(
      `SELECT DISTINCT r.user_id, r.role FROM alert_recipients r
        WHERE r.tenant_id = $1 AND r.state = 'OPEN' AND r.role IN ('TEACHER','PARENT','ADMIN')`,
      [tenantId],
    );
    const byRole = new Map<string, typeof recipients>();
    for (const r of recipients) byRole.set(r.role, [...(byRole.get(r.role) ?? []), r]);
    const picked: typeof recipients = [];
    for (let i = 0; picked.length < SUMMARY_USERS && i < recipients.length; i++)
      for (const list of byRole.values())
        if (list[i] && picked.length < SUMMARY_USERS) picked.push(list[i]);
    const cold: number[] = [];
    const warm: number[] = [];
    for (const r of picked) {
      await redis.del(attentionKeys.summary(tenantId, r.user_id, r.role));
      let t0 = performance.now();
      await query.summary(tenantId, r.user_id, r.role, { role: r.role as UserRole });
      cold.push(performance.now() - t0);
      t0 = performance.now();
      await query.summary(tenantId, r.user_id, r.role, { role: r.role as UserRole });
      warm.push(performance.now() - t0);
    }
    const roleMix = [...byRole].map(([k, v]) => `${k}=${v.length}`).join(' ');
    console.log(`perf: summary users=${picked.length} of distinct recipients (${roleMix})`);
    const summaryRows = (label: string, v: number[]) =>
      `| ${label} | ${ms(percentile(v, 50))} | ${ms(percentile(v, 95))} | ${ms(Math.max(...v))} |`;

    // 3. platform.provider_failures: the hourly cross-school scan of communication_logs.
    const rule = registry.get('platform.provider_failures')!;
    const platformCtx = await context.build(tenantId, fastNow);
    const scan: number[] = [];
    for (let i = 0; i < SWEEP_RUNS; i++) {
      const t0 = performance.now();
      await rule.evaluate(platformCtx);
      scan.push(performance.now() - t0);
    }
    const plan: { 'QUERY PLAN': string }[] = await db.query(
      `EXPLAIN (ANALYZE, BUFFERS) SELECT COUNT(*)::int AS n, COUNT(DISTINCT tenant_id)::int AS schools
         FROM communication_logs WHERE status = 'FAILED' AND updated_at >= $1`,
      [new Date(fastNow.getTime() - 3_600_000)],
    );
    console.log('perf: EXPLAIN of the provider_failures scan:');
    for (const p of plan) console.log(`perf:   ${p['QUERY PLAN']}`);

    const cpus = os.cpus();
    let sha = 'unknown';
    try {
      sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    } catch {
      /* not a git checkout */
    }
    console.log(`
Environment: ${cpus[0]?.model ?? 'cpu'} x${cpus.length}, ${(os.totalmem() / 2 ** 30).toFixed(0)} GB RAM, ${String(version).split(' on ')[0]}, Node ${process.version}, git ${sha}, ${new Date().toISOString().slice(0, 10)}.
Data: ${counts.students} students, ${counts.sections} sections, ${counts.logs} communication_logs.

| Sweep | First run | Median (steady) | Max (steady) |
| --- | --- | --- | --- |
${sweepRows.join('\n')}

| GET /attention/summary (service level, ${picked.length} users) | p50 | p95 | max |
| --- | --- | --- | --- |
${summaryRows('cold (cache key deleted)', cold)}
${summaryRows('warm (cache hit)', warm)}

| platform.provider_failures rule, ${counts.logs} communication_logs | median | max |
| --- | --- | --- |
| evaluate() x${SWEEP_RUNS} | ${ms(percentile(scan, 50))} | ${ms(Math.max(...scan))} |`);
    return 0;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
