import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from './validation-pipe';
import { UserRole, FeeStatus, PaymentMethod } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_SECTION_1_ID,
  SEED_CLASS_1_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/**
 * [5.1] Family-facing read API — the full authorization matrix.
 *
 * Before [5.1], `GET /students/:id` was the only endpoint a PARENT or
 * STUDENT could call. [5.1] opened the fee, invoice and payment reads to
 * them, each guarded by one shared object-level linkage check
 * (`FamilyAccessService`). That widening is only safe if *every* one of
 * those routes refuses a caller who is not linked to the student named in
 * the URL — including when the caller edits the id by hand.
 *
 * ```
 *                     ┌──────────────┐
 *  PARENT / STUDENT → │ RolesGuard   │ "may this role attempt the route?"
 *                     └──────┬───────┘
 *                            ▼
 *                     ┌──────────────────────┐
 *                     │ FamilyAccessService  │ "is this caller linked to
 *                     │  assertLinked(...)   │  THIS student, in THIS
 *                     └──────┬───────────────┘  tenant?"
 *                            ▼
 *                       service layer (still tenant-scoped)
 * ```
 *
 * The cast:
 *
 * | user           | tenant A membership | tenant B membership | linked to |
 * |----------------|---------------------|---------------------|-----------|
 * | parent         | PARENT              | PARENT              | childOne, childTwo (A); childInB (B) |
 * | studentUser    | STUDENT             | —                   | selfStudent (A), by `students.user_id` |
 * | strangerParent | PARENT              | —                   | nobody    |
 * | teacher        | TEACHER             | —                   | n/a (staff) |
 * | admin (seed)   | ADMIN               | ADMIN               | n/a (staff) |
 *
 * `parent` holding a real membership in both tenants is the point of the
 * tenant-isolation block: `ContextGuard` lets them into either tenant, so
 * anything that leaks tenant B's child through an `X-Tenant-ID: A` call is
 * the *service layer* failing, not the guard.
 */

const API = '/api/v1';

const TENANT_B = '00000000-0000-4000-8000-0000005b0001';
const TENANT_B_AY = '00000000-0000-4000-8000-0000005b0002';
const TENANT_B_CLASS = '00000000-0000-4000-8000-0000005b0003';
const TENANT_B_SECTION = '00000000-0000-4000-8000-0000005b0004';

const PARENT_USER_ID = '00000000-0000-4000-8000-0000005b0010';
const STUDENT_USER_ID = '00000000-0000-4000-8000-0000005b0011';
const STRANGER_USER_ID = '00000000-0000-4000-8000-0000005b0012';
const TEACHER_USER_ID = '00000000-0000-4000-8000-0000005b0013';

const PARENT_EMAIL = 'family-parent@e2e.example';
const STUDENT_EMAIL = 'family-student@e2e.example';
const STRANGER_EMAIL = 'family-stranger@e2e.example';
const TEACHER_EMAIL = 'family-teacher@e2e.example';

const NONEXISTENT_UUID = '00000000-0000-4000-8000-0000005bdead';

/** Internal staff free text on a payment. Must never reach a family caller. */
const STAFF_ONLY_REMARK = 'Internal staff note — cash counted twice, till drawer 3';

describe('[5.1] Family-facing read API', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let http: () => supertest.SuperTest<supertest.Test>;

  let adminToken: string;
  let parentToken: string;
  let studentToken: string;
  let strangerToken: string;
  let teacherToken: string;

  // Tenant A students
  let childOneId: string;
  let childTwoId: string;
  let unlinkedChildId: string;
  let selfStudentId: string;
  let softDeletedChildId: string;
  // Tenant B
  let childInBId: string;

  // A SELECTED-applicability fee structure whose roster holds the *unlinked*
  // child — the cross-family PII case for GET /fee-structures/:id.
  let selectedFeeStructureId: string;

  // Invoices
  let childOneInvoiceId: string;
  let unlinkedChildInvoiceId: string;
  let childInBInvoiceId: string;

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  /** Every family route, as `(name, path-for-a-given-student-id)`. */
  const STUDENT_SCOPED_ROUTES = [
    { name: 'GET /students/:id', path: (id: string) => `${API}/students/${id}` },
    { name: 'GET /payments/student/:id', path: (id: string) => `${API}/payments/student/${id}` },
    {
      name: 'GET /payments/invoices/student/:id',
      path: (id: string) => `${API}/payments/invoices/student/${id}`,
    },
  ];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);
    http = () => supertest(app.getHttpServer()) as unknown as supertest.SuperTest<supertest.Test>;

    // --- Tenant B and its academic scaffolding ---
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Family Read Tenant B', 'family-read-tenant-b', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    await dataSource.query(
      `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
       VALUES ($1, 'B 2026', '2026-01-01', '2026-12-31', true, $2, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B_AY, TENANT_B],
    );
    await dataSource.query(
      `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ($1, 'B Class', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TENANT_B_CLASS, TENANT_B_AY, TENANT_B],
    );
    await dataSource.query(
      `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
       VALUES ($1, 'B Section', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TENANT_B_SECTION, TENANT_B_CLASS, TENANT_B],
    );

    // --- Accounts. All reuse the seeded bcrypt hash, so they log in with
    //     SEED_ADMIN_PASSWORD like every other e2e fixture user. ---
    const accounts: Array<[string, string, string]> = [
      [PARENT_USER_ID, PARENT_EMAIL, 'Family Parent'],
      [STUDENT_USER_ID, STUDENT_EMAIL, 'Family Student'],
      [STRANGER_USER_ID, STRANGER_EMAIL, 'Unrelated Parent'],
      [TEACHER_USER_ID, TEACHER_EMAIL, 'Family Teacher'],
    ];
    for (const [id, email, name] of accounts) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH, name],
      );
    }

    const memberships: Array<[string, string, UserRole]> = [
      [PARENT_USER_ID, SEED_TENANT_ID, UserRole.PARENT],
      // The genuine second membership — ContextGuard will happily admit this
      // user to tenant B, so any isolation below comes from the query layer.
      [PARENT_USER_ID, TENANT_B, UserRole.PARENT],
      [STUDENT_USER_ID, SEED_TENANT_ID, UserRole.STUDENT],
      [STRANGER_USER_ID, SEED_TENANT_ID, UserRole.PARENT],
      [TEACHER_USER_ID, SEED_TENANT_ID, UserRole.TEACHER],
      // The seeded admin needs tenant B too, so staff-side assertions can
      // be made there as well.
      [SEED_ADMIN_USER_ID, TENANT_B, UserRole.ADMIN],
    ];
    for (const [userId, tenantId, role] of memberships) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [userId, tenantId, role],
      );
    }

    adminToken = await login(SEED_ADMIN_EMAIL);
    parentToken = await login(PARENT_EMAIL);
    studentToken = await login(STUDENT_EMAIL);
    strangerToken = await login(STRANGER_EMAIL);
    teacherToken = await login(TEACHER_EMAIL);

    await setupFixtures();
  }, 120000);

  /**
   * Recreated before **every** test.
   *
   * `test/setup.ts` installs a global `beforeEach` that TRUNCATEs every
   * transactional table (students, guardians, payments, invoices, …) to keep
   * specs independent. Schools, users, user_tenants, classes and sections
   * survive it, which is why the cast and the tenant scaffolding are built
   * once in `beforeAll` and only the data below is rebuilt here.
   *
   * Everything is inserted with SQL rather than through the API: it is far
   * faster over ~70 tests, and it dodges the STRICT_RATE_LIMIT throttle on
   * `POST /invoices` / `POST /payments`, which a per-test API-driven setup
   * would trip.
   */
  async function setupFixtures(): Promise<void> {
    const makeStudent = async (
      fullName: string,
      opts: { tenantId?: string; sectionId?: string; userId?: string } = {},
    ): Promise<string> => {
      const rows = await dataSource.query(
        `INSERT INTO students
           (full_name, registration_number, roll_number, class_section_id, tenant_id,
            user_id, enrollment_status, preferred_communication, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', 'SMS', NOW(), NOW())
         RETURNING id`,
        [
          fullName,
          `FR-${Math.random().toString(36).slice(2, 12)}`,
          Math.floor(Math.random() * 1000000),
          opts.sectionId ?? SEED_SECTION_1_ID,
          opts.tenantId ?? SEED_TENANT_ID,
          opts.userId ?? null,
        ],
      );
      return rows[0].id as string;
    };

    childOneId = await makeStudent('Child One');
    childTwoId = await makeStudent('Child Two');
    unlinkedChildId = await makeStudent('Unlinked Child');
    softDeletedChildId = await makeStudent('Soft Deleted Child');
    selfStudentId = await makeStudent('Self Student', { userId: STUDENT_USER_ID });
    childInBId = await makeStudent('Child In B', {
      tenantId: TENANT_B,
      sectionId: TENANT_B_SECTION,
    });

    // --- Guardian linkage ---
    const makeGuardian = async (
      userId: string | null,
      tenantId: string,
      name: string,
    ): Promise<string> => {
      const rows = await dataSource.query(
        `INSERT INTO guardians (full_name, relationship, phone, email, tenant_id, user_id,
                                preferred_communication, is_primary_contact, created_at, updated_at)
         VALUES ($1, 'FATHER', '+8801700000000', $2, $3, $4, 'SMS', true, NOW(), NOW())
         RETURNING id`,
        [name, `${name.replace(/\s+/g, '-').toLowerCase()}@e2e.example`, tenantId, userId],
      );
      return rows[0].id as string;
    };

    // `Guardian.user_id` is a @OneToOne, so one account can hold only one
    // guardian row — the tenant-A and tenant-B linkages hang off the *same*
    // row. That is precisely why the tenant filter, not the linkage, has to
    // do the isolation work in the tenant-isolation block below.
    const parentGuardian = await makeGuardian(PARENT_USER_ID, SEED_TENANT_ID, 'Guardian A');
    // A real guardian record belonging to nobody this suite reads, so the
    // refusals below mean "not linked to *this* student" rather than "has no
    // guardian record at all".
    await makeGuardian(STRANGER_USER_ID, SEED_TENANT_ID, 'Guardian S');

    const link = (guardianId: string, studentId: string) =>
      dataSource.query(
        `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [studentId, guardianId],
      );

    await link(parentGuardian, childOneId);
    await link(parentGuardian, childTwoId);
    await link(parentGuardian, softDeletedChildId);
    await link(parentGuardian, childInBId);

    // --- Student fees, so /fees/dues has rows to (not) leak ---
    const makeFee = async (
      studentId: string,
      academicYearId = SEED_ACADEMIC_YEAR_ID,
    ): Promise<string> => {
      const rows = await dataSource.query(
        `INSERT INTO student_fees
           (student_id, academic_year_id, month, year, total_amount, paid_amount,
            discount_amount, status, due_date, reminder_threshold_date, created_at, updated_at)
         VALUES ($1, $2, 1, 2026, 1000, 0, 0, $3, '2026-01-10', '2026-01-20', NOW(), NOW())
         RETURNING id`,
        [studentId, academicYearId, FeeStatus.PENDING],
      );
      return rows[0].id as string;
    };

    // Kept, because childOne's invoice attaches to it — `Invoice.student_fee`
    // is the relation that drags `reminder_threshold_date` into a response.
    const childOneFeeId = await makeFee(childOneId);
    await makeFee(childTwoId);
    await makeFee(unlinkedChildId);
    await makeFee(selfStudentId);
    await makeFee(softDeletedChildId);
    await makeFee(childInBId, TENANT_B_AY);

    // --- Payments, attributed to the seeded admin so received_by_user_id
    //     and remarks are populated — the two staff-only fields the family
    //     serializer must strip. ---
    const makePayment = (studentId: string, tenantId: string) =>
      dataSource.query(
        `INSERT INTO payments
           (student_id, total_amount, payment_method, payment_status, transaction_reference,
            remarks, received_by_user_id, payment_date, tenant_id, created_at, updated_at)
         VALUES ($1, 250, $2, 'SUCCESS', $3, $4, $5, NOW(), $6, NOW(), NOW())`,
        [
          studentId,
          PaymentMethod.CASH,
          `TXN-${studentId.slice(0, 8)}`,
          STAFF_ONLY_REMARK,
          SEED_ADMIN_USER_ID,
          tenantId,
        ],
      );

    await makePayment(childOneId, SEED_TENANT_ID);
    await makePayment(selfStudentId, SEED_TENANT_ID);
    await makePayment(unlinkedChildId, SEED_TENANT_ID);
    await makePayment(childInBId, TENANT_B);

    // --- Invoices ---
    const makeInvoice = async (
      studentId: string,
      studentFeeId: string | null = null,
    ): Promise<string> => {
      const rows = await dataSource.query(
        `INSERT INTO invoices
           (invoice_number, student_id, student_fee_id, total_amount, tax_amount,
            discount_amount, status, issued_date, due_date, line_items, issued_by_user_id,
            notes, created_at, updated_at)
         VALUES ($1, $2, $3, 1000, 0, 0, 'ISSUED', '2026-01-01', '2026-01-31', $4, $5,
                 'Thank you', NOW(), NOW())
         RETURNING id`,
        [
          `INV-${Math.random().toString(36).slice(2, 12).toUpperCase()}`,
          studentId,
          studentFeeId,
          JSON.stringify([{ description: 'Tuition', amount: 1000, quantity: 1, total: 1000 }]),
          SEED_ADMIN_USER_ID,
        ],
      );
      return rows[0].id as string;
    };

    // --- A SELECTED-applicability fee structure listing the unlinked child.
    //     `FeeStructureService.findOne` eager-loads `selected_students.student`
    //     for the staff edit dialog; a family caller must never receive it. ---
    const feeStructureRows = await dataSource.query(
      `INSERT INTO fee_structures
         (fee_type, name, amount, applicability, class_id, academic_year_id, month,
          is_recurring, tenant_id, created_at, updated_at)
       VALUES ('MONTHLY_TUITION', 'Selected Scholarship', 500, 'SELECTED', $1, $2, 1,
               true, $3, NOW(), NOW())
       RETURNING id`,
      [SEED_CLASS_1_ID, SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID],
    );
    selectedFeeStructureId = feeStructureRows[0].id as string;
    await dataSource.query(
      `INSERT INTO fee_structure_students (fee_structure_id, student_id) VALUES ($1, $2)`,
      [selectedFeeStructureId, unlinkedChildId],
    );

    childOneInvoiceId = await makeInvoice(childOneId, childOneFeeId);
    unlinkedChildInvoiceId = await makeInvoice(unlinkedChildId);
    childInBInvoiceId = await makeInvoice(childInBId);

    // Soft-delete last, so the fee above could still be attached to it.
    await dataSource.query(`UPDATE students SET deleted_at = NOW() WHERE id = $1`, [
      softDeletedChildId,
    ]);
  }

  beforeEach(async () => {
    await setupFixtures();
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM fee_structure_students`);
    await dataSource.query(`DELETE FROM fee_structures`);
    await dataSource.query(`DELETE FROM payment_allocations`);
    await dataSource.query(`DELETE FROM invoices`);
    await dataSource.query(`DELETE FROM payments`);
    await dataSource.query(`DELETE FROM student_fees`);
    await dataSource.query(`DELETE FROM student_guardians`);
    await dataSource.query(`DELETE FROM students WHERE tenant_id IN ($1, $2)`, [
      SEED_TENANT_ID,
      TENANT_B,
    ]);
    await dataSource.query(`DELETE FROM guardians WHERE tenant_id IN ($1, $2)`, [
      SEED_TENANT_ID,
      TENANT_B,
    ]);
    await dataSource.query(`DELETE FROM user_tenants WHERE tenant_id = $1`, [TENANT_B]);
    await dataSource.query(`DELETE FROM user_tenants WHERE user_id IN ($1, $2, $3, $4)`, [
      PARENT_USER_ID,
      STUDENT_USER_ID,
      STRANGER_USER_ID,
      TEACHER_USER_ID,
    ]);
    await dataSource.query(`DELETE FROM class_sections WHERE tenant_id = $1`, [TENANT_B]);
    await dataSource.query(`DELETE FROM classes WHERE tenant_id = $1`, [TENANT_B]);
    await dataSource.query(`DELETE FROM academic_years WHERE tenant_id = $1`, [TENANT_B]);
    await dataSource.query(`DELETE FROM schools WHERE id = $1`, [TENANT_B]);
    await dataSource.query(`DELETE FROM users WHERE id IN ($1, $2, $3, $4)`, [
      PARENT_USER_ID,
      STUDENT_USER_ID,
      STRANGER_USER_ID,
      TEACHER_USER_ID,
    ]);
    await app.close();
  });

  // ───────────────────────── Discovery ─────────────────────────

  describe('GET /students/mine — child discovery', () => {
    it('returns exactly the children the calling PARENT is linked to', async () => {
      const res = await http()
        .get(`${API}/students/mine`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(res.body.map((s: { id: string }) => s.id).sort()).toEqual(
        [childOneId, childTwoId].sort(),
      );
    });

    it('returns only the calling STUDENT’s own record', async () => {
      const res = await http()
        .get(`${API}/students/mine`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(res.body.map((s: { id: string }) => s.id)).toEqual([selfStudentId]);
    });

    // An empty list, not a 401/404: "you have no children on file" is a
    // legitimate state for a freshly created parent account, and the portal
    // should render an empty state rather than an error.
    it('returns an empty list — not an error — for a parent linked to nobody', async () => {
      const res = await http()
        .get(`${API}/students/mine`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    // Route-ordering regression: `students/mine` is declared above
    // `students/:id`, which has no ParseUUIDPipe. If the order is ever
    // flipped, Nest matches `:id` first and this 200 becomes a 404.
    it('is not swallowed by the students/:id route', async () => {
      const res = await http()
        .get(`${API}/students/mine`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('omits a soft-deleted child from the list', async () => {
      const res = await http()
        .get(`${API}/students/mine`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(res.body.map((s: { id: string }) => s.id)).not.toContain(softDeletedChildId);
    });

    it('carries no credential or guardian-contact fields', async () => {
      const res = await http()
        .get(`${API}/students/mine`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      const body = JSON.stringify(res.body);
      expect(body).not.toContain('password_hash');
      for (const student of res.body) {
        expect(student.guardians).toBeUndefined();
      }
    });

    // 401, not the conventional 403: `RolesGuard` throws
    // `UnauthorizedException` for a role mismatch (its own docstring says
    // 403, but the code has always thrown 401). Pinned as-is — changing the
    // status code is a breaking API change well outside [5.1].
    it('refuses a staff caller — this is the family discovery route, not a roster', async () => {
      for (const token of [adminToken, teacherToken]) {
        await http()
          .get(`${API}/students/mine`)
          .set('Authorization', `Bearer ${token}`)
          .set('X-Tenant-ID', SEED_TENANT_ID)
          .expect(401);
      }
    });

    it('requires an X-Tenant-ID header', async () => {
      await http()
        .get(`${API}/students/mine`)
        .set('Authorization', `Bearer ${parentToken}`)
        .expect(401);
    });

    it('requires authentication', async () => {
      await http().get(`${API}/students/mine`).set('X-Tenant-ID', SEED_TENANT_ID).expect(401);
    });
  });

  // ─────────────── URL id manipulation, per route ───────────────

  describe('URL id manipulation — a same-tenant but unlinked student id', () => {
    for (const route of STUDENT_SCOPED_ROUTES) {
      it(`${route.name} refuses a PARENT who is not linked to that student`, async () => {
        await http()
          .get(route.path(unlinkedChildId))
          .set('Authorization', `Bearer ${parentToken}`)
          .set('X-Tenant-ID', SEED_TENANT_ID)
          .expect(401);
      });

      it(`${route.name} refuses a STUDENT reading someone else's record`, async () => {
        await http()
          .get(route.path(childOneId))
          .set('Authorization', `Bearer ${studentToken}`)
          .set('X-Tenant-ID', SEED_TENANT_ID)
          .expect(401);
      });

      it(`${route.name} admits the linked PARENT for their own child`, async () => {
        await http()
          .get(route.path(childOneId))
          .set('Authorization', `Bearer ${parentToken}`)
          .set('X-Tenant-ID', SEED_TENANT_ID)
          .expect(200);
      });

      it(`${route.name} admits the STUDENT for their own record`, async () => {
        await http()
          .get(route.path(selfStudentId))
          .set('Authorization', `Bearer ${studentToken}`)
          .set('X-Tenant-ID', SEED_TENANT_ID)
          .expect(200);
      });

      // A nonexistent id must not become a probe: whatever the status, the
      // response must not confirm or deny that the student exists in a way
      // a linked id wouldn't.
      it(`${route.name} refuses a family caller for a nonexistent student id`, async () => {
        const res = await http()
          .get(route.path(NONEXISTENT_UUID))
          .set('Authorization', `Bearer ${parentToken}`)
          .set('X-Tenant-ID', SEED_TENANT_ID);

        expect([401, 404]).toContain(res.status);
      });
    }

    it('GET /invoices/:id refuses a PARENT for another student’s invoice', async () => {
      await http()
        .get(`${API}/invoices/${unlinkedChildInvoiceId}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(401);
    });

    it('GET /invoices/:id admits a PARENT for their own child’s invoice', async () => {
      await http()
        .get(`${API}/invoices/${childOneInvoiceId}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);
    });

    it('GET /invoices/:id/print refuses a PARENT for another student’s invoice', async () => {
      await http()
        .get(`${API}/invoices/${unlinkedChildInvoiceId}/print`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(401);
    });

    it('GET /invoices/:id/print admits a PARENT for their own child’s invoice', async () => {
      const res = await http()
        .get(`${API}/invoices/${childOneInvoiceId}/print`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(res.text).toContain('<html');
    });

    it('GET /invoices/:id refuses a STUDENT for someone else’s invoice', async () => {
      await http()
        .get(`${API}/invoices/${childOneInvoiceId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(401);
    });

    it('refuses the unrelated parent on every student-scoped route', async () => {
      for (const route of STUDENT_SCOPED_ROUTES) {
        await http()
          .get(route.path(childOneId))
          .set('Authorization', `Bearer ${strangerToken}`)
          .set('X-Tenant-ID', SEED_TENANT_ID)
          .expect(401);
      }
      await http()
        .get(`${API}/invoices/${childOneInvoiceId}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(401);
    });
  });

  // ───────────────── List routes: implicit scoping ─────────────────

  describe('GET /invoices — list scoping', () => {
    it('returns only the calling parent’s children’s invoices', async () => {
      const res = await http()
        .get(`${API}/invoices`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      const studentIds = res.body.data.map((i: { student_id: string }) => i.student_id);
      expect(studentIds).toContain(childOneId);
      expect(studentIds).not.toContain(unlinkedChildId);
    });

    // The `student_id` query param is caller-controlled. It may only narrow
    // the already-restricted set, never widen it.
    it('returns an empty page when student_id names an unlinked student', async () => {
      const res = await http()
        .get(`${API}/invoices?student_id=${unlinkedChildId}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('returns an empty page for a parent linked to nobody', async () => {
      const res = await http()
        .get(`${API}/invoices`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('still returns the whole tenant to staff', async () => {
      const res = await http()
        .get(`${API}/invoices`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      const studentIds = res.body.data.map((i: { student_id: string }) => i.student_id);
      expect(studentIds).toContain(childOneId);
      expect(studentIds).toContain(unlinkedChildId);
    });
  });

  describe('GET /fees/dues — list scoping', () => {
    it('returns only the calling parent’s children’s dues', async () => {
      const res = await http()
        .get(`${API}/fees/dues`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      const studentIds = res.body.data.map((d: { student_id: string }) => d.student_id);
      expect(studentIds.sort()).toEqual([childOneId, childTwoId].sort());
    });

    it('returns only the calling student’s own dues', async () => {
      const res = await http()
        .get(`${API}/fees/dues`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(res.body.data.map((d: { student_id: string }) => d.student_id)).toEqual([
        selfStudentId,
      ]);
    });

    // class_id/section_id are the only student-selecting filters on this
    // route. They can narrow the family's own set but must not reach past it
    // — here the whole seeded section is requested and only linked rows
    // come back.
    it('does not let a section filter widen a family caller’s result', async () => {
      const res = await http()
        .get(`${API}/fees/dues?section_id=${SEED_SECTION_1_ID}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      const studentIds = res.body.data.map((d: { student_id: string }) => d.student_id);
      expect(studentIds).not.toContain(unlinkedChildId);
      expect(studentIds).not.toContain(selfStudentId);
    });

    // Same internal dunning field the invoice-summary route strips. `DueEntry`
    // carries it too, so the family dues page is allow-listed as well.
    it('strips reminder_threshold_date from a family caller’s dues rows', async () => {
      const family = await http()
        .get(`${API}/fees/dues`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(family.body.data.length).toBeGreaterThan(0);
      for (const summary of family.body.data) {
        expect(summary.dues.length).toBeGreaterThan(0);
        for (const due of summary.dues) {
          expect(due).not.toHaveProperty('reminder_threshold_date');
          expect(due).toHaveProperty('balance');
        }
      }
      expect(JSON.stringify(family.body)).not.toContain('reminder_threshold_date');
    });

    it('keeps reminder_threshold_date on the staff dues rows', async () => {
      const staff = await http()
        .get(`${API}/fees/dues`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(staff.body.data[0].dues[0]).toHaveProperty('reminder_threshold_date');
    });

    it('returns an empty page for a parent linked to nobody', async () => {
      const res = await http()
        .get(`${API}/fees/dues`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('still returns the whole tenant to staff', async () => {
      const res = await http()
        .get(`${API}/fees/dues`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      const studentIds = res.body.data.map((d: { student_id: string }) => d.student_id);
      expect(studentIds).toContain(childOneId);
      expect(studentIds).toContain(unlinkedChildId);
    });

    it('omits a soft-deleted child from a family caller’s dues', async () => {
      const res = await http()
        .get(`${API}/fees/dues`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(res.body.data.map((d: { student_id: string }) => d.student_id)).not.toContain(
        softDeletedChildId,
      );
    });
  });

  describe('GET /fee-structures — catalog', () => {
    // The published price list: tenant-scoped but not student-scoped, so no
    // object check applies and a family caller sees the same rows staff do.
    it('admits PARENT and STUDENT', async () => {
      for (const token of [parentToken, studentToken]) {
        await http()
          .get(`${API}/fee-structures`)
          .set('Authorization', `Bearer ${token}`)
          .set('X-Tenant-ID', SEED_TENANT_ID)
          .expect(200);
      }
    });

    /**
     * The cross-family PII case. `FeeStructureService.findOne` eager-loads
     * `selected_students.student` in full so the staff edit dialog can
     * prefill its student picker. Without shaping, a parent could list
     * `/fee-structures` for ids and then read every *other* family's child
     * off any SELECTED-applicability structure — name, date of birth,
     * gender, home address, registration number, login user id.
     */
    it('does not expose the selected-students roster to a family caller', async () => {
      const res = await http()
        .get(`${API}/fee-structures/${selectedFeeStructureId}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(res.body).not.toHaveProperty('selected_students');
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('Unlinked Child');
      expect(body).not.toContain(unlinkedChildId);
      expect(body).not.toContain('date_of_birth');
      expect(body).not.toContain('home_address');
      // …while still returning the catalog data the portal needs.
      expect(res.body).toMatchObject({
        id: selectedFeeStructureId,
        name: 'Selected Scholarship',
        applicability: 'SELECTED',
      });
    });

    it('still gives staff the selected-students roster', async () => {
      const res = await http()
        .get(`${API}/fee-structures/${selectedFeeStructureId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      // Proves the assertions above are the shaping working, not an empty
      // fixture.
      expect(res.body.selected_students).toHaveLength(1);
      expect(res.body.selected_students[0].student.full_name).toBe('Unlinked Child');
    });

    it('does not expose the roster to a STUDENT caller either', async () => {
      const res = await http()
        .get(`${API}/fee-structures/${selectedFeeStructureId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(res.body).not.toHaveProperty('selected_students');
    });

    it('shapes the family list rows too', async () => {
      const family = await http()
        .get(`${API}/fee-structures`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(family.body.data.length).toBeGreaterThan(0);
      for (const structure of family.body.data) {
        expect(structure).not.toHaveProperty('selected_students');
        expect(structure).toHaveProperty('amount');
      }
    });

    it('rejects a family caller scoped to a tenant they do not belong to', async () => {
      await http()
        .get(`${API}/fee-structures`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_B)
        .expect(401);
    });
  });

  // ─────────────────────── Response shaping ───────────────────────

  describe('response shaping — no staff-only or credential fields', () => {
    it('strips remarks, received_by and received_by_user_id from family payment history', async () => {
      const res = await http()
        .get(`${API}/payments/student/${childOneId}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(res.body.length).toBeGreaterThan(0);
      for (const payment of res.body) {
        expect(payment).not.toHaveProperty('remarks');
        expect(payment).not.toHaveProperty('received_by');
        expect(payment).not.toHaveProperty('received_by_user_id');
      }
      // The staff note really was recorded — otherwise this assertion would
      // pass against an empty fixture.
      expect(JSON.stringify(res.body)).not.toContain('till drawer 3');
      // …and the family still gets what they came for.
      expect(res.body[0]).toMatchObject({ student_id: childOneId });
      expect(res.body[0]).toHaveProperty('total_amount');
      expect(res.body[0]).toHaveProperty('payment_date');
    });

    it('keeps staff payment responses unchanged', async () => {
      const res = await http()
        .get(`${API}/payments/student/${childOneId}`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(res.body[0]).toHaveProperty('remarks');
      expect(res.body[0].remarks).toContain('till drawer 3');
      expect(res.body[0]).toHaveProperty('received_by_user_id');
    });

    it('strips staff-only fields from the family invoice summary', async () => {
      const res = await http()
        .get(`${API}/payments/invoices/student/${childOneId}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      for (const payment of res.body.payments) {
        expect(payment).not.toHaveProperty('remarks');
        expect(payment).not.toHaveProperty('received_by_user_id');
      }
      // reminder_threshold_date is internal dunning plumbing.
      for (const fee of res.body.fee_breakdown) {
        expect(fee).not.toHaveProperty('reminder_threshold_date');
      }
      expect(res.body.summary).toHaveProperty('balance');
    });

    it('keeps the staff invoice summary unchanged', async () => {
      const res = await http()
        .get(`${API}/payments/invoices/student/${childOneId}`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(res.body.fee_breakdown[0]).toHaveProperty('reminder_threshold_date');
      expect(res.body.payments[0]).toHaveProperty('remarks');
    });

    it('drops issued_by and issued_by_user_id from a family invoice', async () => {
      const res = await http()
        .get(`${API}/invoices/${childOneInvoiceId}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(res.body.issued_by).toBeNull();
      expect(res.body).not.toHaveProperty('issued_by_user_id');
      expect(JSON.stringify(res.body)).not.toContain('password_hash');
      expect(JSON.stringify(res.body)).not.toContain(SEED_ADMIN_EMAIL);
      expect(res.body).toHaveProperty('invoice_number');
      expect(res.body).toHaveProperty('line_items');
    });

    it('drops issued_by_user_id from every row of a family invoice list', async () => {
      const res = await http()
        .get(`${API}/invoices`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      for (const invoice of res.body.data) {
        expect(invoice).not.toHaveProperty('issued_by_user_id');
        expect(invoice.issued_by).toBeNull();
      }
      expect(JSON.stringify(res.body)).not.toContain('password_hash');
    });

    // `findOne` and `findAll` both join `invoice.student_fee`, which carries
    // `reminder_threshold_date` — the same internal field stripped from the
    // dues and invoice-summary routes. Consistency matters more than the one
    // field: the family invoice goes through an allow-list DTO.
    it('strips reminder_threshold_date from the family invoice’s student_fee', async () => {
      const detail = await http()
        .get(`${API}/invoices/${childOneInvoiceId}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(detail.body.student_fee).not.toBeNull();
      expect(detail.body.student_fee).not.toHaveProperty('reminder_threshold_date');
      expect(detail.body.student_fee).toHaveProperty('month');
      expect(JSON.stringify(detail.body)).not.toContain('reminder_threshold_date');

      const list = await http()
        .get(`${API}/invoices`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(JSON.stringify(list.body)).not.toContain('reminder_threshold_date');
    });

    // The family invoice carries the child's name for the header, but not
    // their date of birth or home address.
    it('allow-lists the student relation on a family invoice', async () => {
      const res = await http()
        .get(`${API}/invoices/${childOneInvoiceId}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(res.body.student).toMatchObject({ id: childOneId, full_name: 'Child One' });
      expect(res.body.student).not.toHaveProperty('date_of_birth');
      expect(res.body.student).not.toHaveProperty('home_address');
      expect(res.body.student).not.toHaveProperty('user_id');
    });

    it('keeps reminder_threshold_date on the staff invoice', async () => {
      const res = await http()
        .get(`${API}/invoices/${childOneInvoiceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(res.body.student_fee).toHaveProperty('reminder_threshold_date');
    });

    it('keeps the staff invoice response carrying issued_by, minus password_hash', async () => {
      const res = await http()
        .get(`${API}/invoices/${childOneInvoiceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(res.body.issued_by).toBeTruthy();
      expect(res.body.issued_by).not.toHaveProperty('password_hash');
    });

    it('never leaks password_hash on any family-facing route', async () => {
      const paths = [
        `${API}/students/mine`,
        `${API}/students/${childOneId}`,
        `${API}/fees/dues`,
        `${API}/fee-structures`,
        `${API}/fee-structures/${selectedFeeStructureId}`,
        `${API}/payments/student/${childOneId}`,
        `${API}/payments/invoices/student/${childOneId}`,
        `${API}/invoices`,
        `${API}/invoices/${childOneInvoiceId}`,
        `${API}/invoices/${childOneInvoiceId}/print`,
      ];

      for (const path of paths) {
        const res = await http()
          .get(path)
          .set('Authorization', `Bearer ${parentToken}`)
          .set('X-Tenant-ID', SEED_TENANT_ID)
          .expect(200);

        const body = typeof res.text === 'string' ? res.text : JSON.stringify(res.body);
        expect(body, `${path} leaked a credential field`).not.toContain('password_hash');
      }
    });
  });

  // ───────────────────── Tenant isolation ─────────────────────

  describe('tenant isolation — a parent with memberships in both tenants', () => {
    it('cannot reach their tenant-B child through an X-Tenant-ID: A call', async () => {
      for (const route of STUDENT_SCOPED_ROUTES) {
        const res = await http()
          .get(route.path(childInBId))
          .set('Authorization', `Bearer ${parentToken}`)
          .set('X-Tenant-ID', SEED_TENANT_ID);

        expect([401, 404], `${route.name} leaked tenant B`).toContain(res.status);
      }
    });

    it('cannot reach their tenant-B child’s invoice through an X-Tenant-ID: A call', async () => {
      for (const path of [
        `${API}/invoices/${childInBId ? childInBInvoiceId : ''}`,
        `${API}/invoices/${childInBInvoiceId}/print`,
      ]) {
        const res = await http()
          .get(path)
          .set('Authorization', `Bearer ${parentToken}`)
          .set('X-Tenant-ID', SEED_TENANT_ID);

        expect([401, 404]).toContain(res.status);
      }
    });

    it('does not list the tenant-B child under X-Tenant-ID: A', async () => {
      const res = await http()
        .get(`${API}/students/mine`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(res.body.map((s: { id: string }) => s.id)).not.toContain(childInBId);
    });

    it('does not list tenant-B dues or invoices under X-Tenant-ID: A', async () => {
      const dues = await http()
        .get(`${API}/fees/dues`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);
      expect(dues.body.data.map((d: { student_id: string }) => d.student_id)).not.toContain(
        childInBId,
      );

      const invoices = await http()
        .get(`${API}/invoices`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);
      expect(invoices.body.data.map((i: { student_id: string }) => i.student_id)).not.toContain(
        childInBId,
      );
    });

    // The mirror image: with the *correct* tenant header the same caller and
    // the same fixture succeed. Without this, every assertion above could be
    // passing for the wrong reason (a broken fixture).
    it('reaches the same child correctly under X-Tenant-ID: B', async () => {
      const mine = await http()
        .get(`${API}/students/mine`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', TENANT_B)
        .expect(200);
      expect(mine.body.map((s: { id: string }) => s.id)).toEqual([childInBId]);

      await http()
        .get(`${API}/students/${childInBId}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', TENANT_B)
        .expect(200);

      await http()
        .get(`${API}/invoices/${childInBInvoiceId}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', TENANT_B)
        .expect(200);
    });

    it('rejects a family caller for a tenant they hold no membership in', async () => {
      // studentUser has no tenant-B membership at all — ContextGuard stops
      // this one before any query runs.
      await http()
        .get(`${API}/students/mine`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_B)
        .expect(401);
    });
  });

  // ─────────────────── Role guards, both directions ───────────────────

  /**
   * Every refusal here is a 401 rather than a 403: `RolesGuard` throws
   * `UnauthorizedException` on a role mismatch. Unconventional, pre-existing,
   * and deliberately left alone by [5.1].
   */
  describe('role guards — routes [5.1] deliberately did not widen', () => {
    const STAFF_ONLY_GETS = [
      { name: 'GET /students (roster)', path: `${API}/students` },
      { name: 'GET /payments (ledger)', path: `${API}/payments` },
      { name: 'GET /fees/dues/flagged', path: `${API}/fees/dues/flagged` },
      { name: 'GET /guardians', path: `${API}/guardians` },
    ];

    for (const route of STAFF_ONLY_GETS) {
      it(`${route.name} still refuses PARENT and STUDENT`, async () => {
        for (const token of [parentToken, studentToken]) {
          await http()
            .get(route.path)
            .set('Authorization', `Bearer ${token}`)
            .set('X-Tenant-ID', SEED_TENANT_ID)
            .expect(401);
        }
      });
    }

    // Explicitly out of scope per the [5.1] plan: widening it would need a
    // guardian-record → user check nothing requires yet.
    it('GET /payments/guardian/:guardianId stays staff-only', async () => {
      await http()
        .get(`${API}/payments/guardian/${NONEXISTENT_UUID}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(401);
    });

    it('POST /invoices still refuses a family caller', async () => {
      await http()
        .post(`${API}/invoices`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({
          student_id: childOneId,
          line_items: [{ description: 'Self-issued', amount: 1, quantity: 1 }],
        })
        .expect(401);
    });

    it('PATCH and DELETE /students/:id still refuse a family caller', async () => {
      await http()
        .patch(`${API}/students/${childOneId}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ full_name: 'Renamed By Parent' })
        .expect(401);

      await http()
        .delete(`${API}/students/${childOneId}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(401);
    });
  });

  describe('role guards — staff admissions [5.1] must not have disturbed', () => {
    const WIDENED_ROUTES = () => [
      { name: 'GET /students/:id', path: `${API}/students/${childOneId}` },
      { name: 'GET /fees/dues', path: `${API}/fees/dues` },
      { name: 'GET /fee-structures', path: `${API}/fee-structures` },
      { name: 'GET /fee-structures/:id', path: `${API}/fee-structures/${selectedFeeStructureId}` },
      { name: 'GET /payments/student/:id', path: `${API}/payments/student/${childOneId}` },
      {
        name: 'GET /payments/invoices/student/:id',
        path: `${API}/payments/invoices/student/${childOneId}`,
      },
      { name: 'GET /invoices', path: `${API}/invoices` },
      { name: 'GET /invoices/:id', path: `${API}/invoices/${childOneInvoiceId}` },
      { name: 'GET /invoices/:id/print', path: `${API}/invoices/${childOneInvoiceId}/print` },
    ];

    it('still admits TEACHER everywhere it did before', async () => {
      for (const route of WIDENED_ROUTES()) {
        await http()
          .get(route.path)
          .set('Authorization', `Bearer ${teacherToken}`)
          .set('X-Tenant-ID', SEED_TENANT_ID)
          .expect(200);
      }
    });

    it('still admits ADMIN everywhere it did before', async () => {
      for (const route of WIDENED_ROUTES()) {
        await http()
          .get(route.path)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', SEED_TENANT_ID)
          .expect(200);
      }
    });

    // Staff are not "linked" to anyone; the object check must stay a no-op
    // for them or [5.1] would have quietly locked staff out of most reads.
    it('does not subject a staff caller to the linkage check', async () => {
      await http()
        .get(`${API}/payments/student/${unlinkedChildId}`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);
    });
  });

  // ─────────────────────────── Soft delete ───────────────────────────

  describe('soft delete', () => {
    it('404s a soft-deleted student for staff, as it always did', async () => {
      await http()
        .get(`${API}/students/${softDeletedChildId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(404);
    });

    // Same outcome for the linked parent — [5.1] must not have created a
    // path that resurrects a deleted record for the family.
    it('refuses a soft-deleted student for the linked parent too', async () => {
      for (const route of STUDENT_SCOPED_ROUTES) {
        const res = await http()
          .get(route.path(softDeletedChildId))
          .set('Authorization', `Bearer ${parentToken}`)
          .set('X-Tenant-ID', SEED_TENANT_ID);

        expect([401, 404], `${route.name} exposed a soft-deleted student`).toContain(res.status);
      }
    });
  });
});
