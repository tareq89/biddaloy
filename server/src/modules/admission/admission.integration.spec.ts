import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { SEED_TENANT_ID, SEED_SECTION_1_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import { AdmissionApplicantService } from './admission-applicant.service';
import { ApplicantReviewService } from './applicant-review.service';
import { AdmissionIntake } from './entities/admission-intake.entity';
import { AdmissionApplicant } from './entities/admission-applicant.entity';
import { AdmissionEvaluation } from './entities/admission-evaluation.entity';
import { IntakeService } from './intake.service';
import { StudentService, GuardianService } from '../students/students.service';

const SEED_SLUG = 'test-school';

/**
 * [27.6] End-to-end coverage of the whole wave-1/2 admission backend flow,
 * exercised through the real Nest providers rather than HTTP (unlike
 * `public-admission.controller.e2e-spec.ts`, which only covers the public
 * submission surface): public submit -> staff evaluate (shortlist) -> staff
 * admit -> a real Student + Guardian exist, and every step stayed inside
 * `SEED_TENANT_ID`.
 */
describe('Admission flow (integration)', () => {
  let app: TestingModule;
  let dataSource: DataSource;
  let applicantService: AdmissionApplicantService;
  let reviewService: ApplicantReviewService;
  let intakeService: IntakeService;
  let guardianService: GuardianService;
  let studentService: StudentService;

  async function createIntake(overrides: Partial<Record<string, unknown>> = {}): Promise<string> {
    const res = await dataSource.query(
      `INSERT INTO admission_intakes
         (id, tenant_id, class_section_id, title, seat_count, open_date, close_date, required_document_types, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4, $5::date, $6::date, $7::jsonb, NOW(), NOW())
       RETURNING id`,
      [
        SEED_TENANT_ID,
        SEED_SECTION_1_ID,
        (overrides.title as string) ?? 'Class 1 Admission 2026',
        (overrides.seat_count as number) ?? 2,
        (overrides.open_date as string) ?? '2026-01-01',
        (overrides.close_date as string) ?? '2099-12-31',
        JSON.stringify((overrides.required_document_types as string[]) ?? []),
      ],
    );
    return res[0].id;
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set to run integration tests');
    }
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    dataSource = app.get(DataSource);
    applicantService = app.get(AdmissionApplicantService);
    reviewService = app.get(ApplicantReviewService);
    intakeService = app.get(IntakeService);
    guardianService = app.get(GuardianService);
    studentService = app.get(StudentService);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM admission_evaluations WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
    ]);
    await dataSource.query(`DELETE FROM admission_applicants WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
    ]);
    await dataSource.query(`DELETE FROM admission_intakes WHERE tenant_id = $1`, [SEED_TENANT_ID]);
  });

  it('findAll returns class and section names', async () => {
    const intakeId = await createIntake();
    const [expected] = await dataSource.query(
      `SELECT c.name AS class_name, cs.section_name FROM class_sections cs
         JOIN classes c ON c.id = cs.class_id WHERE cs.id = $1`,
      [SEED_SECTION_1_ID],
    );
    const rows = await intakeService.findAll(SEED_TENANT_ID);
    const row = rows.find((r) => r.id === intakeId);
    expect(row?.class_name).toBe(expected.class_name);
    expect(row?.section_name).toBe(expected.section_name);
  });

  it('an intake still shows names after its section is soft-deleted', async () => {
    const intakeId = await createIntake();
    await dataSource.query(`UPDATE class_sections SET deleted_at = NOW() WHERE id = $1`, [
      SEED_SECTION_1_ID,
    ]);
    try {
      const rows = await intakeService.findAll(SEED_TENANT_ID);
      const row = rows.find((r) => r.id === intakeId);
      expect(row?.section_name).toBeTruthy();
      expect(row?.class_name).toBeTruthy();
    } finally {
      await dataSource.query(`UPDATE class_sections SET deleted_at = NULL WHERE id = $1`, [
        SEED_SECTION_1_ID,
      ]);
    }
  });

  it("tenant B's intakes are not returned to tenant A", async () => {
    const mine = await createIntake();
    const otherTenantId = '00000000-0000-4000-8000-00000000dead';
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Intake Other', 'intake-other', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [otherTenantId],
    );
    const [theirs] = await dataSource.query(
      `INSERT INTO admission_intakes
         (id, tenant_id, class_section_id, title, seat_count, open_date, close_date, required_document_types, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, 'Other Tenant Intake', 1, '2026-01-01', '2099-12-31', '[]'::jsonb, NOW(), NOW())
       RETURNING id`,
      [otherTenantId, SEED_SECTION_1_ID],
    );
    try {
      const ids = (await intakeService.findAll(SEED_TENANT_ID)).map((r) => r.id);
      expect(ids).toContain(mine);
      expect(ids).not.toContain(theirs.id);
    } finally {
      await dataSource.query(`DELETE FROM admission_intakes WHERE tenant_id = $1`, [otherTenantId]);
    }
  });

  it('submit -> shortlist -> admit produces a Student + Guardian, tenant-scoped throughout', async () => {
    const intakeId = await createIntake();

    // 1. Public submit — no tenant/auth context, resolved from the slug.
    const submitted = await applicantService.submit(
      SEED_SLUG,
      {
        intake_id: intakeId,
        applicant_name: 'Rahim Uddin',
        date_of_birth: '2018-05-01',
        gender: 'MALE',
        guardian_name: 'Karim Uddin',
        guardian_phone: '01700000123',
      },
      [],
    );
    expect(submitted.reference_number).toMatch(/^ADM-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(submitted.status).toBe('PENDING');

    const [applicantRow] = await dataSource.query(
      `SELECT id, tenant_id, status FROM admission_applicants WHERE reference_number = $1`,
      [submitted.reference_number],
    );
    expect(applicantRow.tenant_id).toBe(SEED_TENANT_ID);
    const applicantId: string = applicantRow.id;

    // 2. Staff evaluate: shortlist.
    const shortlisted = await reviewService.evaluate(
      applicantId,
      { notes: 'Looks promising', decision: 'SHORTLIST' },
      SEED_TENANT_ID,
      SEED_ADMIN_USER_ID,
    );
    expect(shortlisted.status).toBe('SHORTLISTED');

    const evaluationsAfterShortlist = await dataSource.query(
      `SELECT decision, tenant_id, reviewer_user_id FROM admission_evaluations WHERE applicant_id = $1`,
      [applicantId],
    );
    expect(evaluationsAfterShortlist).toHaveLength(1);
    expect(evaluationsAfterShortlist[0].decision).toBe('SHORTLIST');
    expect(evaluationsAfterShortlist[0].tenant_id).toBe(SEED_TENANT_ID);
    expect(evaluationsAfterShortlist[0].reviewer_user_id).toBe(SEED_ADMIN_USER_ID);

    // 3. Staff admit — converts to a real Student + Guardian.
    const admitted = await reviewService.admit(
      applicantId,
      { notes: 'Welcome aboard' },
      SEED_TENANT_ID,
      SEED_ADMIN_USER_ID,
    );
    expect(admitted.status).toBe('ADMITTED');

    // A second evaluation row was appended (append-only — see
    // `admission-evaluations.tab.ts`'s file doc comment), not merged into
    // the shortlist row.
    const evaluationsAfterAdmit = await dataSource.query(
      `SELECT decision FROM admission_evaluations WHERE applicant_id = $1 ORDER BY created_at`,
      [applicantId],
    );
    expect(evaluationsAfterAdmit.map((e: { decision: string }) => e.decision)).toEqual([
      'SHORTLIST',
      'ADMIT',
    ]);

    const [guardianRow] = await dataSource.query(
      // Canonical (880...), not the raw '01700000123' submitted — see the
      // storage-side note in admission-applicant.service.ts.
      `SELECT id, tenant_id, phone FROM guardians WHERE tenant_id = $1 AND phone = $2`,
      [SEED_TENANT_ID, '8801700000123'],
    );
    expect(guardianRow).toBeDefined();
    expect(guardianRow.tenant_id).toBe(SEED_TENANT_ID);

    const [studentRow] = await dataSource.query(
      `SELECT id, tenant_id, full_name, class_section_id FROM students
       WHERE tenant_id = $1 AND full_name = $2`,
      [SEED_TENANT_ID, 'Rahim Uddin'],
    );
    expect(studentRow).toBeDefined();
    expect(studentRow.tenant_id).toBe(SEED_TENANT_ID);
    expect(studentRow.class_section_id).toBe(SEED_SECTION_1_ID);

    const [guardianLink] = await dataSource.query(
      `SELECT 1 FROM student_guardians WHERE student_id = $1 AND guardian_id = $2`,
      [studentRow.id, guardianRow.id],
    );
    expect(guardianLink).toBeDefined();
  });

  it("never lets a request scoped to another tenant read or mutate this tenant's applicant", async () => {
    const intakeId = await createIntake();
    const submitted = await applicantService.submit(
      SEED_SLUG,
      {
        intake_id: intakeId,
        applicant_name: 'Fatima Begum',
        date_of_birth: '2019-01-10',
        gender: 'FEMALE',
        guardian_name: 'Nusrat Begum',
        guardian_phone: '01700000456',
      },
      [],
    );
    const [applicantRow] = await dataSource.query(
      `SELECT id FROM admission_applicants WHERE reference_number = $1`,
      [submitted.reference_number],
    );

    const otherTenantId = '00000000-0000-4000-8000-00000000dead';
    await expect(
      reviewService.evaluate(
        applicantRow.id,
        { notes: 'Wrong tenant', decision: 'SHORTLIST' },
        otherTenantId,
        SEED_ADMIN_USER_ID,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    // Untouched: no evaluation row, still PENDING.
    const evaluations = await dataSource.query(
      `SELECT 1 FROM admission_evaluations WHERE applicant_id = $1`,
      [applicantRow.id],
    );
    expect(evaluations).toHaveLength(0);
    const [stillPending] = await dataSource.query(
      `SELECT status FROM admission_applicants WHERE id = $1`,
      [applicantRow.id],
    );
    expect(stillPending.status).toBe('PENDING');
  });
  describe('guardian match [LIFE-09]', () => {
    const MATCH_PHONE = '01711000555';
    const PHONE_CANONICAL = '8801711000555';
    let guardianId: string;

    async function submitApplicant(): Promise<string> {
      const intakeId = await createIntake({ seat_count: 5 });
      const submitted = await applicantService.submit(
        SEED_SLUG,
        {
          intake_id: intakeId,
          applicant_name: 'Match Child',
          date_of_birth: '2018-05-01',
          gender: 'MALE',
          guardian_name: 'Typed Name',
          guardian_phone: MATCH_PHONE,
        },
        [],
      );
      const [row] = await dataSource.query(
        `SELECT id FROM admission_applicants WHERE reference_number = $1`,
        [submitted.reference_number],
      );
      return row.id;
    }

    beforeEach(async () => {
      // Another family: guardian G with a live child and a soft-deleted child.
      const g = await guardianService.create(
        { full_name: 'Other Family Parent', phone: PHONE_CANONICAL },
        SEED_TENANT_ID,
      );
      guardianId = g.id;
      await studentService.create(
        {
          full_name: 'Live Sibling',
          class_section_id: SEED_SECTION_1_ID,
          date_of_birth: '2016-01-01',
          gender: 'MALE',
          guardian_ids: [g.id],
        },
        SEED_TENANT_ID,
      );
      const gone = await studentService.create(
        {
          full_name: 'Gone Sibling',
          // High explicit roll: a soft-deleted row still holds its unique roll slot.
          roll_number: 9000,
          class_section_id: SEED_SECTION_1_ID,
          date_of_birth: '2015-01-01',
          gender: 'MALE',
          guardian_ids: [g.id],
        },
        SEED_TENANT_ID,
      );
      await dataSource.query(`UPDATE students SET deleted_at = NOW() WHERE id = $1`, [gone.id]);
    });

    afterEach(async () => {
      await dataSource.query(
        `DELETE FROM student_guardians WHERE guardian_id IN (SELECT id FROM guardians WHERE tenant_id = $1 AND full_name IN ('Other Family Parent', 'Typed Name'))`,
        [SEED_TENANT_ID],
      );
      await dataSource.query(
        `DELETE FROM students WHERE tenant_id = $1 AND full_name IN ('Live Sibling', 'Gone Sibling', 'Match Child')`,
        [SEED_TENANT_ID],
      );
      await dataSource.query(
        `DELETE FROM guardians WHERE tenant_id = $1 AND full_name IN ('Other Family Parent', 'Typed Name')`,
        [SEED_TENANT_ID],
      );
    });

    it('admit with a matching guardian and no choice is refused and creates no student', async () => {
      const id = await submitApplicant();
      const err = await reviewService
        .admit(id, {}, SEED_TENANT_ID, SEED_ADMIN_USER_ID)
        .catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse().details.code).toBe('GUARDIAN_MATCH_NEEDS_CHOICE');
      const students = await dataSource.query(
        `SELECT 1 FROM students WHERE tenant_id = $1 AND full_name = 'Match Child'`,
        [SEED_TENANT_ID],
      );
      expect(students).toHaveLength(0);
    });

    it('CREATE_NEW leaves G with its old children only', async () => {
      const id = await submitApplicant();
      await reviewService.admit(
        id,
        { guardian_choice: 'CREATE_NEW' },
        SEED_TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      const [child] = await dataSource.query(
        `SELECT s.id FROM students s WHERE s.tenant_id = $1 AND s.full_name = 'Match Child'`,
        [SEED_TENANT_ID],
      );
      const links = await dataSource.query(
        `SELECT guardian_id FROM student_guardians WHERE student_id = $1`,
        [child.id],
      );
      expect(links).toHaveLength(1);
      expect(links[0].guardian_id).not.toBe(guardianId);
      const gKids = await dataSource.query(
        `SELECT 1 FROM student_guardians WHERE guardian_id = $1`,
        [guardianId],
      );
      expect(gKids).toHaveLength(2);
    });

    it('LINK_EXISTING links the child to G', async () => {
      const id = await submitApplicant();
      await reviewService.admit(
        id,
        { guardian_choice: 'LINK_EXISTING', guardian_id: guardianId },
        SEED_TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      const gKids = await dataSource.query(
        `SELECT 1 FROM student_guardians WHERE guardian_id = $1`,
        [guardianId],
      );
      expect(gKids).toHaveLength(3);
    });

    it('[#2250] two guardians share the phone: LINK_EXISTING links exactly the guardian_id sent', async () => {
      // CREATE_NEW deliberately makes a second guardian on the same phone.
      const second = await guardianService.create(
        { full_name: 'Typed Name', phone: PHONE_CANONICAL },
        SEED_TENANT_ID,
      );
      const id = await submitApplicant();
      // The preview is deterministic: the oldest guardian, every time.
      expect((await reviewService.guardianMatch(id, SEED_TENANT_ID)).guardian?.id).toBe(guardianId);

      await reviewService.admit(
        id,
        { guardian_choice: 'LINK_EXISTING', guardian_id: second.id },
        SEED_TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      const [child] = await dataSource.query(
        `SELECT s.id FROM students s WHERE s.tenant_id = $1 AND s.full_name = 'Match Child'`,
        [SEED_TENANT_ID],
      );
      const links = await dataSource.query(
        `SELECT guardian_id FROM student_guardians WHERE student_id = $1`,
        [child.id],
      );
      expect(links).toEqual([{ guardian_id: second.id }]);
    });

    it('[#2250] LINK_EXISTING with a guardian_id on another phone is refused', async () => {
      const other = await guardianService.create(
        { full_name: 'Typed Name', phone: '8801799999990' },
        SEED_TENANT_ID,
      );
      const id = await submitApplicant();
      const err = await reviewService
        .admit(
          id,
          { guardian_choice: 'LINK_EXISTING', guardian_id: other.id },
          SEED_TENANT_ID,
          SEED_ADMIN_USER_ID,
        )
        .catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse().details.code).toBe('GUARDIAN_MATCH_CHANGED');
    });

    it("guardianMatch lists G's live children by name", async () => {
      const id = await submitApplicant();
      const match = await reviewService.guardianMatch(id, SEED_TENANT_ID);
      expect(match.guardian?.id).toBe(guardianId);
      expect(match.guardian?.full_name).toBe('Other Family Parent');
      expect(match.guardian?.student_names).toEqual(['Live Sibling']);
    });

    it('[#2374] a guardian saved in local format still matches the canonical applicant phone', async () => {
      // Staff forms store the phone as typed ("01…"); the public form stores
      // it canonical ("8801…"). Same number, so the family must still be found.
      await dataSource.query(`UPDATE guardians SET phone = $2 WHERE id = $1`, [
        guardianId,
        MATCH_PHONE,
      ]);
      const id = await submitApplicant();
      expect((await reviewService.guardianMatch(id, SEED_TENANT_ID)).guardian?.id).toBe(guardianId);

      const err = await reviewService
        .admit(id, {}, SEED_TENANT_ID, SEED_ADMIN_USER_ID)
        .catch((e) => e);
      expect(err.getResponse().details.code).toBe('GUARDIAN_MATCH_NEEDS_CHOICE');

      await reviewService.admit(
        id,
        { guardian_choice: 'LINK_EXISTING', guardian_id: guardianId },
        SEED_TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      const gKids = await dataSource.query(
        `SELECT 1 FROM student_guardians WHERE guardian_id = $1`,
        [guardianId],
      );
      expect(gKids).toHaveLength(3);
    });

    it('guardianMatch is null when no guardian has that phone', async () => {
      const id = await submitApplicant();
      await dataSource.query(`UPDATE guardians SET phone = '8801799999999' WHERE id = $1`, [
        guardianId,
      ]);
      const match = await reviewService.guardianMatch(id, SEED_TENANT_ID);
      expect(match.guardian).toBeNull();
    });
  });
});
