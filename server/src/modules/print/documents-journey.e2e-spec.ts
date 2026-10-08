import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { UserRole, textPlaceholders } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { ensureFeeStructure, periodStart } from '@test/helpers/fee-fixture.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { todayInSchoolTz } from '../../common/time';
import {
  SEED_TENANT_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_CLASS_1_ID,
  SEED_SECTION_1_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/**
 * [#1953] Epic 48 wave 2, one journey over HTTP as the real roles:
 *
 *   ADMIN        builds the TC + admit-card templates from the library, sets the serial prefix
 *   OFFICE_STAFF issues a transfer certificate           -> DAHS-TC-<year>-00001  (ACCOUNTANT: 403)
 *   EXECUTIVE    reads it in the register (JSON + CSV)
 *   anyone       verifies it; ADMIN revokes it; verify and the register follow
 *   OFFICE_STAFF reprints it                              -> copy 2, same serial, "DUPLICATE" label
 *   PARENT       prints an admit card; withheld while the child owes (D9), allowed once the switch is off
 *   tenant 2     sees none of it
 *
 * The suite wipes tenant data before every test, so the whole journey is ONE test.
 */
const API = '/api/v1';
const CONDUCT = 'তার আচরণ সন্তোষজনক';
const DUPLICATE_LABEL = 'প্রতিলিপি / DUPLICATE (copy 2)';

describe('Documents journey E2E (Epic 48 wave 2)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const tokens: Record<string, string> = {};

  const http = () => supertest(app.getHttpServer());
  const as = (role: string) => ({
    Authorization: `Bearer ${tokens[role]}`,
    'X-Tenant-ID': SEED_TENANT_ID,
  });
  // A bare "expected 201, got 409" hides which step failed; show the body.
  const status = (want: number) => (r: supertest.Response) => {
    if (r.status !== want)
      throw new Error(`expected ${want}, got ${r.status}: ${JSON.stringify(r.body)}`);
  };
  const one = async (sql: string, p: unknown[]) => (await ds.query(sql, p))[0].id as string;

  async function login(email: string): Promise<string> {
    const res = await http()
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  async function addUser(tenantId: string, role: UserRole, label: string) {
    const id = randomUUID();
    const email = `docs-journey-${label}-${id}@e2e.example`;
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW())`,
      [id, email, SEED_ADMIN_PASSWORD_HASH, `Journey ${label}`],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, tenantId, role],
    );
    return { id, email };
  }

  /** ADMIN: template from a library suggestion -> published -> default. Returns its id. */
  async function defaultTemplateFrom(suggestion_key: string, name: string): Promise<string> {
    const tpl = await http()
      .post(`${API}/print-templates`)
      .set(as('ADMIN'))
      .send({ name, suggestion_key })
      .expect(status(201));
    await http()
      .post(`${API}/print-templates/${tpl.body.id}/publish`)
      .set(as('ADMIN'))
      .expect((r) => expect(r.status, JSON.stringify(r.body)).toBeLessThan(300));
    await http()
      .post(`${API}/print-templates/${tpl.body.id}/default`)
      .set(as('ADMIN'))
      .expect((r) => expect(r.status, JSON.stringify(r.body)).toBeLessThan(300));
    return tpl.body.id;
  }

  const setDocumentsSettings = (documents: object) =>
    http()
      .patch(`${API}/schools/${SEED_TENANT_ID}/settings`)
      .set(as('ADMIN'))
      .send({ version: 1, documents })
      .expect(status(200));

  const admitQueueCount = async (role = 'OFFICE_STAFF') => {
    const res = await http().get(`${API}/print-history/queue`).set(as(role)).expect(200);
    return (
      (res.body.by_kind as Array<{ kind: string; count: number }>).find(
        (k) => k.kind === 'EXAM_ADMIT_CARD',
      )?.count ?? 0
    );
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('issues, verifies, revokes, reprints a TC and gates an admit card, tenant-safe', async () => {
    // ---------- fixtures (SQL) ----------
    tokens.ADMIN = await login(SEED_ADMIN_EMAIL);
    for (const role of [UserRole.OFFICE_STAFF, UserRole.ACCOUNTANT, UserRole.EXECUTIVE] as const) {
      tokens[role] = await login((await addUser(SEED_TENANT_ID, role, role)).email);
    }
    const parentUser = await addUser(SEED_TENANT_ID, UserRole.PARENT, 'parent');
    tokens.PARENT = await login(parentUser.email);

    const y = Number(todayInSchoolTz().slice(0, 4));
    // The leaver sits in its own class so it never touches the exam's admit-card queue.
    // The TC sentences use the school address + EIIN and the student's birth date.
    await ds.query(
      `UPDATE schools SET address = 'Dhaka', registration_id = '123456' WHERE id = $1`,
      [SEED_TENANT_ID],
    );
    const tcClass = await one(
      `INSERT INTO classes (name, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id`,
      [`Journey TC ${randomUUID()}`, SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID],
    );
    const tcSection = await one(
      `INSERT INTO class_sections (class_id, section_name, tenant_id, created_at, updated_at)
       VALUES ($1, 'A', $2, NOW(), NOW()) RETURNING id`,
      [tcClass, SEED_TENANT_ID],
    );
    const leaver = await one(
      `INSERT INTO students (full_name, full_name_bn, father_name, mother_name, date_of_birth, registration_number,
                             roll_number, class_section_id, tenant_id, enrollment_status,
                             created_at, updated_at)
       VALUES ('Journey Rahim', 'রহিম', 'Abdul', 'Amena', '2012-04-01', $1, 7, $2, $3, 'ACTIVE', NOW(), NOW())
       RETURNING id`,
      [`JR-${randomUUID().slice(0, 8)}`, tcSection, SEED_TENANT_ID],
    );
    await ds.query(
      `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [leaver, tcClass, tcSection, SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID],
    );

    // Exam with a PUBLISHED seat plan; two ACTIVE classmates, one of them is the parent's child.
    const newStudent = (name: string, roll: number) =>
      one(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id,
                               enrollment_status, preferred_communication, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 'SMS', NOW(), NOW()) RETURNING id`,
        [name, `JA-${randomUUID().slice(0, 8)}`, roll, SEED_SECTION_1_ID, SEED_TENANT_ID],
      );
    const child = await newStudent('Journey Child', 1);
    const classmate = await newStudent('Journey Classmate', 2);
    for (const s of [child, classmate]) {
      await ds.query(
        `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [s, SEED_CLASS_1_ID, SEED_SECTION_1_ID, SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID],
      );
    }
    const guardian = await one(
      `INSERT INTO guardians (user_id, full_name, relationship, tenant_id, created_at, updated_at)
       VALUES ($1, 'Journey Parent', 'PARENT', $2, NOW(), NOW()) RETURNING id`,
      [parentUser.id, SEED_TENANT_ID],
    );
    await ds.query(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`, [
      child,
      guardian,
    ]);
    const exam = await one(
      `INSERT INTO exams (academic_year_id, class_id, name, kind, status, tenant_id, created_at, updated_at)
       VALUES ($1, $2, 'Journey Exam', 'TERM', 'PROCESSED', $3, NOW(), NOW()) RETURNING id`,
      [SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID, SEED_TENANT_ID],
    );
    const subject = await one(
      `INSERT INTO subjects (tenant_id, name_en, code) VALUES ($1, 'Maths', $2) RETURNING id`,
      [SEED_TENANT_ID, `M${randomUUID().slice(0, 6)}`],
    );
    // Far-future date: the queue only lists exams that have not finished yet.
    const sitting = await one(
      `INSERT INTO exam_schedules (tenant_id, exam_id, subject_id, date, starts_at, ends_at)
       VALUES ($1, $2, $3, '2099-03-01', '10:00', '13:00') RETURNING id`,
      [SEED_TENANT_ID, exam, subject],
    );
    const room = await one(
      `INSERT INTO rooms (tenant_id, room_no) VALUES ($1, '101') RETURNING id`,
      [SEED_TENANT_ID],
    );
    const plan = await one(
      `INSERT INTO seat_plans (tenant_id, name, status, seat_order_mode)
       VALUES ($1, 'Journey plan', 'PUBLISHED', 'SEQUENTIAL') RETURNING id`,
      [SEED_TENANT_ID],
    );
    await ds.query(
      `INSERT INTO seat_plan_schedules (tenant_id, seat_plan_id, exam_schedule_id) VALUES ($1, $2, $3)`,
      [SEED_TENANT_ID, plan, sitting],
    );
    for (const [s, seat] of [
      [child, 'A-1'],
      [classmate, 'A-2'],
    ]) {
      await ds.query(
        `INSERT INTO seat_allocations (tenant_id, seat_plan_id, exam_schedule_id, student_id, room_id, seat_number)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [SEED_TENANT_ID, plan, sitting, s, room, seat],
      );
    }
    // The child owes 1000 (a PENDING fee), which is what the withhold switch looks at.
    await ds.query(
      `INSERT INTO student_fees (student_id, academic_year_id, fee_structure_id, period_start,
                                 total_amount, paid_amount, discount_amount, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4::date, 1000, 0, 0, 'PENDING', NOW(), NOW())`,
      [child, SEED_ACADEMIC_YEAR_ID, await ensureFeeStructure(ds), periodStart(5, 2026)],
    );

    // ---------- 1. ADMIN sets up templates + settings ----------
    const tcTpl = await defaultTemplateFrom('tc-a4-bn', 'Journey TC');
    await defaultTemplateFrom('admit-card-bn', 'Journey Admit Card');
    await setDocumentsSettings({ serialPrefix: 'DAHS', withholdAdmitCardForDues: true });

    // ---------- 2. student leaves; OFFICE_STAFF issues the TC; ACCOUNTANT is refused (D40) ----------
    await http()
      .post(`${API}/students/${leaver}/leave`)
      .set(as('ADMIN'))
      .send({
        type: 'TRANSFERRED_OUT',
        occurred_on: todayInSchoolTz(),
        reason: 'Family relocation',
        destination: 'Rajshahi Collegiate School',
      })
      .expect(status(201));

    const issueBody = {
      template_id: tcTpl,
      subject_type: 'STUDENT',
      subject_ids: [leaver],
      // A blank issue value is refused ("required"), so both TC issue fields are typed.
      issue_values: { 'issue.conduct': CONDUCT, 'issue.remark': 'কোনো বকেয়া নেই' },
    };
    await http().post(`${API}/certificates`).set(as('ACCOUNTANT')).send(issueBody).expect(403);
    await http().get(`${API}/print-history/register`).set(as('ACCOUNTANT')).expect(403);

    const issued = await http()
      .post(`${API}/certificates`)
      .set(as('OFFICE_STAFF'))
      .send(issueBody)
      .expect(status(201));
    const first = issued.body.items[0];
    expect(first.serial_no).toBe(`DAHS-TC-${y}-00001`);
    expect(first.copy_number).toBe(1);
    const jobId = issued.body.job_id as string;
    const token = (first.verify_url as string).replace('/v/', '');

    // ---------- 3. EXECUTIVE finds it in the register, JSON and CSV ----------
    const reg = await http()
      .get(`${API}/print-history/register`)
      .set(as('EXECUTIVE'))
      .expect(status(200));
    expect(reg.body.total).toBe(1);
    expect(reg.body.data[0]).toMatchObject({
      serial: `DAHS-TC-${y}-00001`,
      subject_label: 'Journey Rahim',
      copy_number: 1,
      revoked_at: null,
    });
    const csv = await http()
      .get(`${API}/print-history/register.csv`)
      .set(as('EXECUTIVE'))
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => cb(null, data));
      })
      .expect(200);
    expect(String(csv.body)).toContain(`DAHS-TC-${y}-00001`);

    // ---------- 4. reprint (before the revoke: a revoked copy cannot be reprinted, 409): copy 2, same serial, DUPLICATE label, every sentence key filled (D43/D44) ----------
    const re = await http()
      .post(`${API}/certificates/jobs/${jobId}/reprint`)
      .set(as('OFFICE_STAFF'))
      .send({ item_ids: [first.item_id] })
      .expect(status(201));
    const copy2 = re.body.items[0];
    expect(copy2.copy_number).toBe(2);
    expect(copy2.serial_no).toBe(first.serial_no);
    expect(copy2.values['print.copyLabel']).toBe(DUPLICATE_LABEL);

    const detail = await http()
      .get(`${API}/print-history/items/${copy2.item_id}`)
      .set(as('EXECUTIVE'))
      .expect(status(200));
    const keys = textPlaceholders(JSON.stringify(detail.body.template_definition));
    expect(keys.length).toBeGreaterThan(0);
    const blank = keys.filter((k) => !(k in copy2.values) || copy2.values[k] === '');
    expect(blank, `blank/missing placeholder values: ${blank.join(', ')}`).toEqual([]);

    // ---------- 5. verify -> VALID; ADMIN revokes with a reason; verify -> REVOKED ----------
    const valid = await http().get(`${API}/public/verify/${token}`).expect(200);
    expect(valid.body).toMatchObject({ serial: `DAHS-TC-${y}-00001`, status: 'VALID' });
    await http()
      .post(`${API}/print-history/items/${first.item_id}/revoke`)
      .set(as('ADMIN'))
      .send({ reason: 'Issued by mistake' })
      .expect(200);
    const revoked = await http().get(`${API}/public/verify/${token}`).expect(200);
    expect(revoked.body).toMatchObject({ serial: `DAHS-TC-${y}-00001`, status: 'REVOKED' });
    const reg2 = await http()
      .get(`${API}/print-history/register`)
      .set(as('EXECUTIVE'))
      .expect(status(200));
    // The register lists copy 2 first (newest); the revoked row is copy 1.
    const row1 = reg2.body.data.find((r: any) => r.copy_number === 1);
    expect(row1.revoke_reason).toBe('Issued by mistake');
    expect(row1.revoked_at).not.toBeNull();
    expect(reg2.body.data.find((r: any) => r.copy_number === 2).revoked_at).toBeNull();

    // ---------- 6. admit cards: queue, withheld while owing, allowed once the switch is off ----------
    expect(await admitQueueCount()).toBe(2);
    const admit = () =>
      http().post(`${API}/students/${child}/exams/${exam}/admit-card`).set(as('PARENT'));
    const withheld = await admit();
    expect(withheld.status).toBe(409);
    expect(withheld.body.details?.code ?? withheld.body.message?.details?.code).toBe(
      'ADMIT_CARD_WITHHELD',
    );
    expect(await admitQueueCount()).toBe(2); // nothing was printed

    await setDocumentsSettings({ withholdAdmitCardForDues: false });
    const printed = await admit();
    expect(printed.status, JSON.stringify(printed.body)).toBe(200);
    expect(printed.body.items[0].copy_number).toBe(1);
    expect(await admitQueueCount()).toBe(1);

    // ---------- 7. tenant 2 sees none of it ----------
    const t2 = await one(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
      `Journey T2 ${randomUUID()}`,
      `journey-t2-${randomUUID()}`,
    ]);
    const t2Token = await login((await addUser(t2, UserRole.ADMIN, 't2admin')).email);
    const t2Headers = { Authorization: `Bearer ${t2Token}`, 'X-Tenant-ID': t2 };
    const t2Register = await http().get(`${API}/print-history/register`).set(t2Headers).expect(200);
    expect(t2Register.body.total).toBe(0);
    const t2History = await http().get(`${API}/print-history`).set(t2Headers).expect(200);
    expect(t2History.body.total).toBe(0);
    const t2Queue = await http().get(`${API}/print-history/queue`).set(t2Headers).expect(200);
    expect(t2Queue.body.by_kind.find((k: any) => k.kind === 'EXAM_ADMIT_CARD')).toBeUndefined();
    expect(t2Queue.body.exams).toEqual([]);
    await http().get(`${API}/print-history/items/${copy2.item_id}`).set(t2Headers).expect(404);
  });
});
