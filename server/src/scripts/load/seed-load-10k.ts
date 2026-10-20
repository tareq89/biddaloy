import { DataSource, QueryRunner } from 'typeorm';
import { hashPassword } from '../../modules/auth/password-hash';
import { localToday } from '../../common/time';
import { assertThrowawayDatabase } from './load-seed-guard';
import {
  EXTRA_COUNT_TABLES,
  seedExtras,
  seedLastYearBills,
  type ExtrasContext,
} from './seed-load-extras';

// [8.10.7.6.01] Manual only (D24). Never imported by CI, `seed.ts` or the demo seed.
// Plain DataSource + raw SQL: no AppModule, so no workers and no Redis side effects.

export const LOAD_TENANT_SLUG = 'load-test-school';
export const LOAD_EMAIL_DOMAIN = 'biddaloy.test';
/** Role -> login email the run script (6-02) uses. */
export const LOAD_LOGINS: Record<string, string> = {
  ADMIN: `load-admin@${LOAD_EMAIL_DOMAIN}`,
  EXECUTIVE: `load-executive@${LOAD_EMAIL_DOMAIN}`,
  ACCOUNTANT: `load-accountant@${LOAD_EMAIL_DOMAIN}`,
  TEACHER: `load-teacher@${LOAD_EMAIL_DOMAIN}`,
  OFFICE_STAFF: `load-office@${LOAD_EMAIL_DOMAIN}`,
  EXAM_CONTROLLER: `load-exam@${LOAD_EMAIL_DOMAIN}`,
  COMMITTEE: `load-committee@${LOAD_EMAIL_DOMAIN}`,
  PARENT: `load-parent@${LOAD_EMAIL_DOMAIN}`,
};
const CLASSES = 10;
const SECTIONS_PER_CLASS = 5;
const SECTIONS = CLASSES * SECTIONS_PER_CLASS;
const WORKING_DAYS = 60;
const FEE_MONTHS = 10;
const PAST_YEARS = 4;

export interface LoadSeedOptions {
  /** Student count; 10_000 at SCALE=1. At least one per section. */
  students: number;
  password: string;
  /** Tests pin this; real runs use the school's today. */
  today?: string;
}
export type LoadSeedResult =
  | { status: 'already-seeded' }
  | { status: 'seeded'; tenantId: string; counts: Record<string, number>; seconds: number };

/**
 * Creates the load-test school and its volume. Takes an already-open DataSource; it does NOT
 * check the target database - `main()` does that first (and the integration spec runs it on the
 * test worker's own database). Everything is bulk `INSERT ... SELECT generate_series`, in
 * dependency order, one statement per <= 50k-row batch, all in ONE transaction. Dates hang off `today`; "randomness"
 * is a hash of ids, so a rerun on a fresh DB gives the same data.
 */
export async function seedLoadSchool(
  ds: DataSource,
  opts: LoadSeedOptions,
): Promise<LoadSeedResult> {
  const started = Date.now();
  // One transaction for the whole seed: a failure leaves nothing behind, so a rerun starts clean.
  const runner = ds.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const result = await seedInTransaction(runner, opts, started);
    await runner.commitTransaction();
    return result;
  } catch (e) {
    await runner.rollbackTransaction();
    throw e;
  } finally {
    await runner.release();
  }
}

async function seedInTransaction(
  runner: QueryRunner,
  opts: LoadSeedOptions,
  started: number,
): Promise<LoadSeedResult> {
  const q = <R = Record<string, any>>(sql: string, params: unknown[] = []): Promise<R[]> =>
    runner.query(sql, params);
  const students = Math.max(SECTIONS, Math.round(opts.students));
  const today = opts.today ?? localToday();

  const [existing] = await q(`SELECT id FROM schools WHERE slug = $1`, [LOAD_TENANT_SLUG]);
  if (existing) return { status: 'already-seeded' };

  const passwordHash = await hashPassword(opts.password);

  const [{ id: tenantId }] = await q<{ id: string }>(
    `INSERT INTO schools (name, slug, created_at, updated_at) VALUES ('Load Test School', $1, NOW(), NOW()) RETURNING id`,
    [LOAD_TENANT_SLUG],
  );

  // Academic years: current + 4 past (committee-enrollment).
  const years = await q<{ id: string }>(
    `INSERT INTO academic_years (tenant_id, name, start_date, end_date, is_current, created_at, updated_at)
     SELECT $1, 'Load year -' || n, (date_trunc('year', $2::date) - n * interval '1 year')::date,
            (date_trunc('year', $2::date) - (n - 1) * interval '1 year' - interval '1 day')::date,
            n = 0, NOW(), NOW()
       FROM generate_series(0, ${PAST_YEARS}) AS n
     RETURNING id`,
    [tenantId, today],
  );
  const [{ id: yearId }] = await q<{ id: string }>(
    `SELECT id FROM academic_years WHERE tenant_id = $1 AND is_current`,
    [tenantId],
  );
  const pastYearIds = years.map((y) => y.id).filter((id) => id !== yearId);

  await q(
    `INSERT INTO classes (tenant_id, academic_year_id, name, numeric_grade, created_at, updated_at)
     SELECT $1, $2, 'Class ' || g, g, NOW(), NOW() FROM generate_series(1, ${CLASSES}) AS g`,
    [tenantId, yearId],
  );
  await q(
    `INSERT INTO class_sections (tenant_id, class_id, section_name, created_at, updated_at)
     SELECT $1, c.id, chr(64 + s), NOW(), NOW()
       FROM classes c, generate_series(1, ${SECTIONS_PER_CLASS}) AS s WHERE c.tenant_id = $1`,
    [tenantId],
  );
  const sectionIds = (
    await q<{ id: string }>(
      `SELECT id FROM class_sections WHERE tenant_id = $1 ORDER BY class_id, section_name`,
      [tenantId],
    )
  ).map((r) => r.id);

  // Students spread round-robin over the 50 sections.
  await q(
    `INSERT INTO students (tenant_id, full_name, registration_number, roll_number, class_section_id,
                           enrollment_status, created_at, updated_at)
     SELECT $1, 'Load Student ' || n, 'LT-' || n, (n - 1) / ${SECTIONS} + 1,
            ($2::uuid[])[(n - 1) % ${SECTIONS} + 1], 'ACTIVE', NOW(), NOW()
       FROM generate_series(1, $3::int) AS n`,
    [tenantId, sectionIds, students],
  );
  await q(
    `INSERT INTO enrollments (tenant_id, student_id, class_id, section_id, academic_year_id, enrollment_status, enrolled_at, created_at, updated_at)
     SELECT s.tenant_id, s.id, cs.class_id, cs.id, $2, 'ACTIVE', NOW(), NOW(), NOW()
       FROM students s JOIN class_sections cs ON cs.id = s.class_section_id WHERE s.tenant_id = $1`,
    [tenantId, yearId],
  );
  // One guardian per student; 2% incomplete (no phone, empty relationship). Phones are not dialable.
  await q(
    `INSERT INTO guardians (tenant_id, full_name, relationship, phone, is_primary_contact, created_at, updated_at)
     SELECT $1, 'Load Guardian ' || s.registration_number,
            CASE WHEN abs(hashtext(s.id::text)) % 100 < 2 THEN '' ELSE 'Father' END,
            CASE WHEN abs(hashtext(s.id::text)) % 100 < 2 THEN NULL
                 ELSE '000' || lpad((abs(hashtext(s.id::text)) % 100000000)::text, 8, '0') END,
            true, NOW(), NOW()
       FROM students s WHERE s.tenant_id = $1 ORDER BY s.registration_number`,
    [tenantId],
  );
  await q(
    `INSERT INTO student_guardians (student_id, guardian_id)
     SELECT s.id, g.id FROM students s
       JOIN guardians g ON g.tenant_id = s.tenant_id AND g.full_name = 'Load Guardian ' || s.registration_number
      WHERE s.tenant_id = $1`,
    [tenantId],
  );

  // Attendance: a register per section per working day (Friday is the weekly off), last 60 days.
  const days = (
    await q<{ d: string }>(
      `SELECT d::date::text AS d FROM generate_series($1::date - 120, $1::date, interval '1 day') d
        WHERE extract(dow FROM d) <> 5 ORDER BY d DESC LIMIT ${WORKING_DAYS}`,
      [today],
    )
  ).map((r) => r.d);
  for (const day of days) {
    await q(
      `INSERT INTO attendance_sessions (tenant_id, section_id, date, period_no, state, source, marked_at, finalized_at)
       SELECT $1, unnest($2::uuid[]), $3::date, NULL, 'FINALIZED', 'SYSTEM', NOW(), NOW()`,
      [tenantId, sectionIds, day],
    );
    await q(
      `INSERT INTO attendance_records (tenant_id, session_id, student_id, date, status, minutes_late, source)
       SELECT sess.tenant_id, sess.id, st.id, sess.date,
              (CASE WHEN h < 90 THEN 'PRESENT' WHEN h < 94 THEN 'LATE' WHEN h < 99 THEN 'ABSENT' ELSE 'LEAVE' END)::attendance_status_enum,
              CASE WHEN h >= 90 AND h < 94 THEN 10 END, 'SYSTEM'
         FROM attendance_sessions sess
         JOIN students st ON st.class_section_id = sess.section_id AND st.tenant_id = sess.tenant_id
         CROSS JOIN LATERAL (SELECT abs(hashtext(st.id::text || sess.date::text)) % 100 AS h) x
        WHERE sess.tenant_id = $1 AND sess.date = $2::date AND sess.period_no IS NULL`,
      [tenantId, day],
    );
  }

  // Fees: monthly tuition per class; FEE_MONTHS bills per student; status mix by hash.
  await q(
    `INSERT INTO fee_structures (tenant_id, fee_type, name, amount, class_id, academic_year_id, created_at, updated_at)
     SELECT $1, 'MONTHLY_TUITION', 'Load tuition ' || c.name, 1000 + 100 * c.numeric_grade, c.id, $2, NOW(), NOW()
       FROM classes c WHERE c.tenant_id = $1`,
    [tenantId, yearId],
  );
  for (let n = 0; n < FEE_MONTHS; n++) {
    await q(
      `INSERT INTO student_fees (student_id, academic_year_id, fee_structure_id, period_start, period_type,
                                 total_amount, paid_amount, discount_amount, one_off_discount_amount, status, due_date, created_at, updated_at)
       SELECT s.id, $2, fs.id, m.p, 'MONTH', fs.amount,
              CASE st WHEN 'PAID' THEN fs.amount WHEN 'PARTIALLY_PAID' THEN fs.amount / 2 ELSE 0 END,
              CASE st WHEN 'WAIVED' THEN fs.amount ELSE 0 END, CASE st WHEN 'WAIVED' THEN fs.amount ELSE 0 END,
              st::student_fees_status_enum, m.p + 10, NOW(), NOW()
         FROM students s
         JOIN class_sections cs ON cs.id = s.class_section_id
         JOIN fee_structures fs ON fs.class_id = cs.class_id AND fs.tenant_id = s.tenant_id
         CROSS JOIN (SELECT (date_trunc('month', $3::date) - ${n} * interval '1 month')::date AS p) m
         CROSS JOIN LATERAL (SELECT abs(hashtext(s.id::text || m.p::text)) % 100 AS h) x
         CROSS JOIN LATERAL (SELECT CASE WHEN h < 2 THEN 'WAIVED'
                                         WHEN ${n} >= 3 THEN CASE WHEN h < 80 THEN 'PAID' WHEN h < 90 THEN 'PARTIALLY_PAID' ELSE 'PENDING' END
                                         ELSE CASE WHEN h < 40 THEN 'PAID' WHEN h < 55 THEN 'PARTIALLY_PAID' ELSE 'PENDING' END END AS st) y
        WHERE s.tenant_id = $1`,
      [tenantId, yearId, today],
    );
    // One SUCCESS payment per paid / part-paid bill; ~1 in 25 of this month's land today.
    await q(
      `INSERT INTO payments (tenant_id, student_id, total_amount, payment_method, payment_status, payment_date, idempotency_key, remarks, created_at, updated_at)
       SELECT $1, sf.student_id, sf.paid_amount,
              (ARRAY['CASH','BKASH','BANK_TRANSFER'])[1 + abs(hashtext(sf.id::text)) % 3]::payments_payment_method_enum,
              'SUCCESS',
              (CASE WHEN ${n} = 0 AND abs(hashtext(sf.id::text)) % 25 = 0 THEN $2::date
                    ELSE LEAST($2::date, sf.period_start + abs(hashtext(sf.id::text)) % 9) END)::timestamptz + interval '6 hours',
              'loadtest:' || sf.id, 'Load test', NOW(), NOW()
         FROM student_fees sf JOIN students s ON s.id = sf.student_id
        WHERE s.tenant_id = $1 AND sf.paid_amount > 0
          AND sf.period_start = (date_trunc('month', $2::date) - ${n} * interval '1 month')::date`,
      [tenantId, today],
    );
  }
  const extras: ExtrasContext = {
    q,
    tenantId,
    yearId,
    days,
    today,
    students,
    teacherUserId: '',
  };
  await seedLastYearBills(extras);
  await q(
    `INSERT INTO payment_allocations (payment_id, student_fee_id, allocated_amount, allocation_type, created_at)
     SELECT p.id, sf.id, p.total_amount, 'CURRENT', NOW()
       FROM payments p JOIN student_fees sf ON 'loadtest:' || sf.id = p.idempotency_key
      WHERE p.tenant_id = $1`,
    [tenantId],
  );

  // One login per role. The parent also gets the 2nd student (two linked children).
  for (const [role, email] of Object.entries(LOAD_LOGINS)) {
    const [{ id: userId }] = await q<{ id: string }>(
      `INSERT INTO users (email, password_hash, status, full_name, email_verified_at, created_at, updated_at)
       VALUES ($1, $2, 'ACTIVE', $3, NOW(), NOW(), NOW()) RETURNING id`,
      [email, passwordHash, `Load ${role}`],
    );
    await q(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3::user_tenants_role_enum, NOW(), NOW())`,
      [userId, tenantId, role],
    );
    if (role === 'TEACHER') extras.teacherUserId = userId;
    if (role === 'PARENT') {
      await q(
        `UPDATE guardians SET user_id = $2 WHERE id = (
           SELECT sg.guardian_id FROM student_guardians sg JOIN students s ON s.id = sg.student_id
            WHERE s.tenant_id = $1 AND s.registration_number = 'LT-1')`,
        [tenantId, userId],
      );
      await q(
        `INSERT INTO student_guardians (student_id, guardian_id)
         SELECT s2.id, g.id FROM guardians g, students s2
          WHERE g.user_id = $2 AND g.tenant_id = $1 AND s2.tenant_id = $1 AND s2.registration_number = 'LT-2'
         ON CONFLICT DO NOTHING`,
        [tenantId, userId],
      );
    }
  }

  await seedExtras(extras);

  // Each past year keeps ~90% of the roll (graduated), pointing at that year's own class and
  // section. Runs after seedExtras so the extra past-year classes are not multiplied into
  // exams, homework or routines (those seed from every class of the tenant).
  for (const pastId of pastYearIds) {
    await q(
      `INSERT INTO classes (tenant_id, academic_year_id, name, numeric_grade, created_at, updated_at)
       SELECT $1, $2::uuid, 'Class ' || g, g, NOW(), NOW() FROM generate_series(1, ${CLASSES}) AS g`,
      [tenantId, pastId],
    );
    await q(
      `INSERT INTO class_sections (tenant_id, class_id, section_name, created_at, updated_at)
       SELECT $1, c.id, chr(64 + s), NOW(), NOW()
         FROM classes c, generate_series(1, ${SECTIONS_PER_CLASS}) AS s
        WHERE c.tenant_id = $1 AND c.academic_year_id = $2::uuid`,
      [tenantId, pastId],
    );
    await q(
      `INSERT INTO enrollments (tenant_id, student_id, class_id, section_id, academic_year_id, enrollment_status, enrolled_at, created_at, updated_at)
       SELECT s.tenant_id, s.id, pc.id, ps.id, $2::uuid, 'GRADUATED', NOW(), NOW(), NOW()
         FROM students s
         JOIN class_sections cs ON cs.id = s.class_section_id
         JOIN classes c ON c.id = cs.class_id
         JOIN classes pc ON pc.tenant_id = s.tenant_id AND pc.academic_year_id = $2::uuid AND pc.numeric_grade = c.numeric_grade
         JOIN class_sections ps ON ps.class_id = pc.id AND ps.section_name = cs.section_name
        WHERE s.tenant_id = $1 AND abs(hashtext(s.id::text || $2::uuid::text)) % 10 < 9`,
      [tenantId, pastId],
    );
  }

  const tables = [
    ...EXTRA_COUNT_TABLES,
    'academic_years',
    'classes',
    'class_sections',
    'students',
    'enrollments',
    'guardians',
    'attendance_sessions',
    'attendance_records',
    'fee_structures',
    'payments',
  ];
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const [{ c }] = await q(`SELECT count(*)::int AS c FROM ${t} WHERE tenant_id = $1`, [tenantId]);
    counts[t] = c;
  }
  const [fees] = await q(
    `SELECT count(*)::int AS c FROM student_fees sf JOIN students s ON s.id = sf.student_id WHERE s.tenant_id = $1`,
    [tenantId],
  );
  counts.student_fees = fees.c;
  // The planner needs real statistics or the load run measures bad plans.
  for (const t of [
    ...tables,
    'student_fees',
    'payment_allocations',
    'student_guardians',
    'result_subjects',
    'seat_plans',
  ]) {
    await q(`ANALYZE ${t}`);
  }
  return { status: 'seeded', tenantId, counts, seconds: (Date.now() - started) / 1000 };
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  try {
    assertThrowawayDatabase(url, process.env);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  const password = process.env.LOAD_PASSWORD ?? '';
  if (password.length < 8) {
    console.error(
      'LOAD_PASSWORD (8+ characters) is required: the password of the eight load logins.',
    );
    process.exit(1);
  }
  const scale = Number(process.env.SCALE ?? '1');
  if (!(scale > 0)) {
    console.error('SCALE must be a positive number.');
    process.exit(1);
  }
  const ds = new DataSource({ type: 'postgres', url });
  await ds.initialize();
  try {
    const r = await seedLoadSchool(ds, { students: 10_000 * scale, password });
    if (r.status === 'seeded') {
      // Outside the transaction (VACUUM cannot run in one): sets the visibility map, which the
      // covering-index scans of the money widgets need - production gets it from autovacuum.
      for (const t of ['payments', 'student_fees', 'attendance_records', 'enrollments', 'marks']) {
        await ds.query(`VACUUM ANALYZE ${t}`);
      }
    }
    if (r.status === 'already-seeded') {
      console.log('already seeded - drop the database to reseed');
      return;
    }
    console.log(`Load school seeded in ${r.seconds.toFixed(1)}s (tenant ${r.tenantId})`);
    console.table(r.counts);
    console.log('Logins (password = LOAD_PASSWORD):');
    for (const email of Object.values(LOAD_LOGINS)) console.log(`  ${email}`);
  } finally {
    await ds.destroy();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
