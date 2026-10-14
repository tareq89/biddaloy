import type { DataSource } from 'typeorm';
import { PeriodSlotKind } from '@biddaloy/shared';
import { checkSlot, type SlotLike } from '../../modules/routines/constraint-check';
import { DEMO_CARDS, DEMO_SCHOOL_SLUGS } from '../../modules/demo/demo-accounts';

/** Weekly off-day is Friday (0=Sun..5=Fri), same default as `schoolDays` in dates.ts. */
const WEEKLY_OFF = 5;
const DEMO = `s.slug LIKE 'bmsc-%'`;

export interface Violation {
  check: 'routine' | 'academic-year' | 'money' | 'attendance' | 'enrollment' | 'logins';
  message: string;
}

type Db = Pick<DataSource, 'query'>;
type Row = Record<string, any>;

/** Each query starts with `/* check:<name> *\/` so a test fake can answer it without a database. */
async function routine(ds: Db): Promise<Violation[]> {
  const rows: Row[] = await ds.query(`/* check:routine */
    SELECT rs.id, rs.section_id, rs.period_slot_id, rs.weekday, rs.subject_id, rs.room_id,
           rs.recurrence, rs.recurrence_offset, rs.valid_from::text AS valid_from,
           rs.valid_to::text AS valid_to, ps.starts_at::text AS starts_at,
           ps.ends_at::text AS ends_at, ps.sequence, ps.kind, t.user_id, s.slug
      FROM routine_slots rs
      JOIN schools s ON s.id = rs.tenant_id
      JOIN period_slots ps ON ps.id = rs.period_slot_id
      JOIN routine_slot_teachers rst ON rst.routine_slot_id = rs.id
      JOIN teachers t ON t.id = rst.teacher_id
     WHERE ${DEMO}`);
  // One entry per (slot, teacher user): a user teaching in two branches is one person (D12).
  const byUser = new Map<string, { slot: SlotLike; kind: PeriodSlotKind; slug: string }[]>();
  for (const r of rows) {
    const slot: SlotLike = {
      id: `${r.id}:${r.user_id}`,
      section_id: r.section_id,
      period_slot_id: r.period_slot_id,
      starts_at: r.starts_at.slice(0, 5),
      ends_at: r.ends_at.slice(0, 5),
      weekday: r.weekday,
      period_sequence: r.sequence,
      subject_id: r.subject_id,
      room_id: null, // rooms and sections are not what this check is about
      recurrence: r.recurrence,
      recurrence_offset: r.recurrence_offset,
      valid_from: r.valid_from,
      valid_to: r.valid_to,
      teacher_ids: [r.user_id],
    };
    (byUser.get(r.user_id) ?? byUser.set(r.user_id, []).get(r.user_id)!).push({
      slot,
      kind: r.kind,
      slug: r.slug,
    });
  }
  const out: Violation[] = [];
  for (const [user, items] of byUser) {
    for (const { slot, kind, slug } of items) {
      const res = checkSlot(
        { ...slot, section_id: `${slot.id}` }, // unique section so SECTION clash can't fire
        items.map((i) => ({ ...i.slot, section_id: i.slot.id! })),
        { id: slot.period_slot_id, kind },
        new Set([`${slot.id}`]),
        {},
      );
      if (res.violations.some((v) => v.code === 'TEACHER_DOUBLE_BOOKED')) {
        out.push({
          check: 'routine',
          message: `teacher user ${user} is double-booked on weekday ${slot.weekday} at ${slot.starts_at} (branch ${slug})`,
        });
      }
    }
  }
  return out;
}

async function academicYear(ds: Db): Promise<Violation[]> {
  const rows: Row[] = await ds.query(`/* check:academic-year */
    SELECT s.slug, count(ay.id)::int AS n
      FROM schools s LEFT JOIN academic_years ay
        ON ay.tenant_id = s.id AND ay.is_current AND ay.deleted_at IS NULL
     WHERE ${DEMO} GROUP BY s.slug HAVING count(ay.id) <> 1`);
  return rows.map((r) => ({
    check: 'academic-year',
    message: `${r.slug} has ${r.n} current academic years, expected exactly 1`,
  }));
}

async function money(ds: Db): Promise<Violation[]> {
  const fees: Row[] = await ds.query(`/* check:money-fees */
    SELECT sf.id, sf.total_amount::float AS total, sf.paid_amount::float AS paid,
           sf.discount_amount::float AS discount,
           COALESCE((SELECT sum(pa.allocated_amount) FROM payment_allocations pa
                      WHERE pa.student_fee_id = sf.id), 0)::float AS allocated
      FROM student_fees sf JOIN students st ON st.id = sf.student_id
      JOIN schools s ON s.id = st.tenant_id
     WHERE sf.deleted_at IS NULL AND ${DEMO}`);
  const out: Violation[] = [];
  for (const f of fees) {
    if (Math.abs(f.paid - f.allocated) > 0.005) {
      out.push({
        check: 'money',
        message: `student_fee ${f.id}: paid_amount ${f.paid} <> sum of allocations ${f.allocated}`,
      });
    }
    if (f.paid + f.discount > f.total + 0.005) {
      out.push({
        check: 'money',
        message: `student_fee ${f.id}: paid ${f.paid} + discount ${f.discount} exceeds total ${f.total}`,
      });
    }
  }
  const noInvoice: Row[] = await ds.query(`/* check:money-invoice */
    SELECT p.id FROM payments p JOIN schools s ON s.id = p.tenant_id
     WHERE p.payment_status = 'SUCCESS' AND p.invoice_id IS NULL
       AND p.reversal_of_payment_id IS NULL AND p.deleted_at IS NULL AND ${DEMO}`);
  for (const p of noInvoice) {
    out.push({ check: 'money', message: `payment ${p.id} is SUCCESS but has no invoice` });
  }
  return out;
}

async function attendance(ds: Db): Promise<Violation[]> {
  const rows: Row[] = await ds.query(
    `/* check:attendance */
    SELECT DISTINCT a.date::text AS date, s.slug,
           extract(dow FROM a.date)::int = $1 AS off_day,
           EXISTS (SELECT 1 FROM public_holiday_entries e
                     JOIN public_holiday_sets hs ON hs.id = e.set_id
                    WHERE hs.country = s.country_code
                      AND a.date BETWEEN e.date AND e.end_date) AS holiday
      FROM attendance_sessions a JOIN schools s ON s.id = a.tenant_id
     WHERE ${DEMO}`,
    [WEEKLY_OFF],
  );
  return rows
    .filter((r) => r.off_day || r.holiday)
    .map((r) => ({
      check: 'attendance',
      message: `${r.slug} has an attendance session on ${r.date}, a ${r.off_day ? 'weekly off-day' : 'holiday'}`,
    }));
}

async function enrollment(ds: Db): Promise<Violation[]> {
  const rows: Row[] = await ds.query(`/* check:enrollment */
    SELECT e.student_id, e.academic_year_id, count(*)::int AS n
      FROM enrollments e JOIN schools s ON s.id = e.tenant_id
     WHERE e.enrollment_status = 'ACTIVE' AND ${DEMO}
     GROUP BY 1, 2 HAVING count(*) > 1`);
  return rows.map((r) => ({
    check: 'enrollment',
    message: `student ${r.student_id} has ${r.n} ACTIVE enrollments in year ${r.academic_year_id}`,
  }));
}

async function logins(ds: Db): Promise<Violation[]> {
  const rows: Row[] = await ds.query(`/* check:logins */
    SELECT u.email, s.slug
      FROM users u JOIN user_tenants ut ON ut.user_id = u.id
      JOIN schools s ON s.id = ut.tenant_id
     WHERE u.email = ANY($1) AND s.slug = ANY($2)
    UNION ALL
    SELECT NULL, s.slug FROM schools s WHERE ${DEMO}`, [
    DEMO_CARDS.map((c) => c.email),
    [...DEMO_SCHOOL_SLUGS],
  ]);
  // No demo branch yet (the org slice is still owed): nothing to check. Coverage rule (c) catches
  // a slice that claims to be done while the branches are missing.
  if (!rows.some((r) => r.email === null)) return [];
  const have = new Set(rows.map((r) => `${r.email}|${r.slug}`));
  return DEMO_CARDS.filter((c) => !have.has(`${c.email}|${c.branchSlug}`)).map((c) => ({
    check: 'logins',
    message: `demo card "${c.key}" (${c.email}) has no user with a membership in ${c.branchSlug}`,
  }));
}

/** Runs every invariant against the seeded demo tenants (`bmsc-*`). Empty array = healthy. */
export async function validate(ds: Db): Promise<Violation[]> {
  const parts = await Promise.all(
    [routine, academicYear, money, attendance, enrollment, logins].map((c) => c(ds)),
  );
  return parts.flat();
}
