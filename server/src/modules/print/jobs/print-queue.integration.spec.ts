import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { PrintHistoryService } from './print-history.service';

/** [48.2.07] The derived print queue: waiting = should exist minus printed (D5, D42). */
describe('print queue (integration)', () => {
  let ds: DataSource;
  let history: PrintHistoryService;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
    history = new PrintHistoryService(ds, { record: async () => undefined } as any);
  });
  afterAll(async () => {
    await ds.destroy();
  });

  const one = async (sql: string, p: unknown[]) => (await ds.query(sql, p))[0].id as string;
  const day = (offset: number) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(
      new Date(Date.now() + offset * 86_400_000),
    );

  type Tenant = {
    id: string;
    section: string;
    cls: string;
    year: string;
    job: string;
    subject: string;
  };
  /** One tenant: school, year, class, template + job (for print items), a subject. */
  async function tenant(): Promise<Tenant> {
    const id = await one(
      `INSERT INTO schools (name, name_bn, slug) VALUES ($1, 'বিদ্যালয়', $2) RETURNING id`,
      [`PQ ${randomUUID()}`, `pq-${randomUUID()}`],
    );
    const year = await one(
      `INSERT INTO academic_years (name, start_date, end_date, tenant_id)
       VALUES ('2026', '2026-01-01', '2026-12-31', $1) RETURNING id`,
      [id],
    );
    const cls = await one(
      `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ('Class 8', $1, $2) RETURNING id`,
      [year, id],
    );
    const tpl = await one(
      `INSERT INTO print_templates (tenant_id, document_kind, name, batch_size, draft)
       VALUES ($1, 'EXAM_ADMIT_CARD', 'T', 1, '{}'::jsonb) RETURNING id`,
      [id],
    );
    const ver = await one(
      `INSERT INTO print_template_versions (tenant_id, template_id, version, definition)
       VALUES ($1, $2, 1, '{}'::jsonb) RETURNING id`,
      [id, tpl],
    );
    const job = await one(
      `INSERT INTO print_jobs (tenant_id, template_version_id, document_kind, item_count)
       VALUES ($1, $2, 'EXAM_ADMIT_CARD', 1) RETURNING id`,
      [id, ver],
    );
    const subject = await one(
      `INSERT INTO subjects (tenant_id, name_en, code) VALUES ($1, 'Math', 'M1') RETURNING id`,
      [id],
    );
    const section = await one(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'A', $2) RETURNING id`,
      [cls, id],
    );
    return { id, section, cls, year, job, subject };
  }

  let roll = 0; // roll numbers are unique per section
  async function student(t: Tenant, status = 'ACTIVE') {
    const sid = await one(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status)
       VALUES ('S', $1, ${++roll}, $4, $2, $3) RETURNING id`,
      [`R-${randomUUID()}`, t.id, status, t.section],
    );
    await ds.query(
      `INSERT INTO enrollments (student_id, class_id, academic_year_id, tenant_id, enrollment_status)
       VALUES ($1, $2, $3, $4, $5)`,
      [sid, t.cls, t.year, t.id, status],
    );
    return sid;
  }

  /** An exam with one sitting on `date` in a seat plan of `planStatus`. */
  async function exam(
    t: Tenant,
    date: string,
    planStatus: 'PUBLISHED' | 'DRAFT',
    name = 'First Term',
  ) {
    const ex = await one(
      `INSERT INTO exams (tenant_id, academic_year_id, class_id, name, kind)
       VALUES ($1, $2, $3, $4, 'TERM') RETURNING id`,
      [t.id, t.year, t.cls, name],
    );
    const es = await one(
      `INSERT INTO exam_schedules (tenant_id, exam_id, subject_id, date, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, '10:00', '12:00') RETURNING id`,
      [t.id, ex, t.subject, date],
    );
    const sp = await one(
      `INSERT INTO seat_plans (tenant_id, name, status, seat_order_mode)
       VALUES ($1, 'Plan', $2, 'SEQUENTIAL') RETURNING id`,
      [t.id, planStatus],
    );
    await ds.query(
      `INSERT INTO seat_plan_schedules (tenant_id, seat_plan_id, exam_schedule_id) VALUES ($1, $2, $3)`,
      [t.id, sp, es],
    );
    return ex;
  }

  // Args are internal test literals/ids, never user input, so they are bound as-is.
  async function printed(
    t: Tenant,
    kind: 'EXAM_ADMIT_CARD' | 'STUDENT_ID_CARD',
    studentId: string,
    opts: { exam?: string } = {},
  ) {
    return one(
      `INSERT INTO print_job_items
         (tenant_id, job_id, document_kind, subject_type, subject_id, subject_label, copy_number,
          context_type, context_id, data_snapshot, verify_token_hash)
       VALUES ($1, $2, $3, 'STUDENT', $4, 'S', 1, $5, $6, '{}'::jsonb, $7) RETURNING id`,
      [
        t.id,
        t.job,
        kind,
        studentId,
        opts.exam ? 'EXAM' : null,
        opts.exam ?? null,
        randomUUID().replace(/-/g, '').padEnd(64, '0'),
      ],
    );
  }

  /** by_kind as a map; ID cards are left out unless asked, so admit-card tests stay focused. */
  const counts = async (t: Tenant, withIdCards = false) => {
    const r = await history.queueCounts(t.id);
    return Object.fromEntries(
      r.by_kind
        .filter((k) => withIdCards || k.kind !== 'STUDENT_ID_CARD')
        .map((k) => [k.kind, k.count]),
    );
  };

  it('admit cards: printed, failed, revoked move the number; past exam and other exam do not count', async () => {
    const t = await tenant();
    const [a, b] = [await student(t), await student(t), await student(t)];
    const ex = await exam(t, day(3), 'PUBLISHED');
    expect(await counts(t)).toEqual({ EXAM_ADMIT_CARD: 3 });

    const item = await printed(t, 'EXAM_ADMIT_CARD', a, { exam: ex });
    expect(await counts(t)).toEqual({ EXAM_ADMIT_CARD: 2 });
    await ds.query(`UPDATE print_job_items SET outcome = 'FAILED' WHERE id = $1`, [item]);
    expect(await counts(t)).toEqual({ EXAM_ADMIT_CARD: 3 });
    await ds.query(`UPDATE print_job_items SET outcome = 'OK', revoked_at = now() WHERE id = $1`, [
      item,
    ]);
    expect(await counts(t)).toEqual({ EXAM_ADMIT_CARD: 3 });

    // A card printed for ANOTHER exam does not count for this one.
    const other = await exam(t, day(5), 'DRAFT', 'Other');
    await printed(t, 'EXAM_ADMIT_CARD', b, { exam: other });
    expect(await counts(t)).toEqual({ EXAM_ADMIT_CARD: 3 });

    // Last sitting yesterday (Dhaka): the exam is over, so it leaves the queue.
    await ds.query(`UPDATE exam_schedules SET date = $1 WHERE exam_id = $2`, [day(-1), ex]);
    expect(await counts(t)).toEqual({});
  });

  it('a DRAFT seat plan alone is not queued', async () => {
    const t = await tenant();
    await student(t);
    await exam(t, day(3), 'DRAFT');
    expect(await counts(t)).toEqual({});
  });

  it('ID cards: ACTIVE only; total = sum of by_kind; exams[].missing sums to the admit count', async () => {
    const t = await tenant();
    const a = await student(t);
    await student(t);
    await student(t, 'TRANSFERRED');
    await printed(t, 'STUDENT_ID_CARD', a);
    await exam(t, day(2), 'PUBLISHED');
    const q = await history.queueCounts(t.id);
    expect(q.by_kind).toEqual([
      { kind: 'EXAM_ADMIT_CARD', count: 2 },
      { kind: 'STUDENT_ID_CARD', count: 1 },
    ]);
    expect(q.total).toBe(3);
    expect(q.exams).toEqual([
      expect.objectContaining({ exam_name: 'First Term', class_name: 'Class 8', missing: 2 }),
    ]);
    expect(q.exams.reduce((n, e) => n + e.missing, 0)).toBe(2);
  });

  it('never leaks across tenants', async () => {
    const t1 = await tenant();
    const t2 = await tenant();
    const s1 = await student(t1);
    await student(t2);
    await student(t2);
    await exam(t2, day(2), 'PUBLISHED');
    await printed(t2, 'STUDENT_ID_CARD', s1); // a t2 item pointing at a t1 student id
    expect(await counts(t1, true)).toEqual({ STUDENT_ID_CARD: 1 });
    expect(await counts(t2, true)).toEqual({ EXAM_ADMIT_CARD: 2, STUDENT_ID_CARD: 2 });
  });

  // Plan seen with enable_seqscan=off: the NOT EXISTS probes print_job_items by index, not Seq Scan.
  it('the ID-card NOT EXISTS uses a print_job_items index', async () => {
    const t = await tenant();
    const plan = await ds.transaction(async (m) => {
      await m.query('SET LOCAL enable_seqscan = off');
      const rows = await m.query(
        `EXPLAIN SELECT 1 FROM students s WHERE s.tenant_id = $1 AND NOT EXISTS (
           SELECT 1 FROM print_job_items i WHERE i.tenant_id = $1 AND i.document_kind = 'STUDENT_ID_CARD'
             AND i.subject_id = s.id AND i.revoked_at IS NULL AND i.outcome <> 'FAILED')`,
        [t.id],
      );
      return rows.map((r: any) => r['QUERY PLAN']).join('\n');
    });
    expect(plan).not.toMatch(/Seq Scan on print_job_items/);
  });

  // Plan seen with enable_seqscan=off: Index Scan using IDX_print_job_items_context.
  it('the admit-card NOT EXISTS (context_id = exam) uses a print_job_items index', async () => {
    const t = await tenant();
    const plan = await ds.transaction(async (m) => {
      await m.query('SET LOCAL enable_seqscan = off');
      const rows = await m.query(
        `EXPLAIN SELECT 1 FROM students s WHERE s.tenant_id = $1 AND NOT EXISTS (
           SELECT 1 FROM print_job_items i WHERE i.tenant_id = $1 AND i.document_kind = 'EXAM_ADMIT_CARD'
             AND i.subject_id = s.id AND i.context_id = $2 AND i.revoked_at IS NULL AND i.outcome <> 'FAILED')`,
        [t.id, randomUUID()],
      );
      return rows.map((r: any) => r['QUERY PLAN']).join('\n');
    });
    expect(plan).not.toMatch(/Seq Scan on print_job_items/);
  });

  it('ID cards: FAILED and revoked copies are still waiting', async () => {
    const t = await tenant();
    const [a, b] = [await student(t), await student(t)];
    const failed = await printed(t, 'STUDENT_ID_CARD', a);
    const revoked = await printed(t, 'STUDENT_ID_CARD', b);
    await ds.query(`UPDATE print_job_items SET outcome = 'FAILED' WHERE id = $1`, [failed]);
    await ds.query(`UPDATE print_job_items SET revoked_at = now() WHERE id = $1`, [revoked]);
    expect(await counts(t, true)).toEqual({ STUDENT_ID_CARD: 2 });
  });
});
