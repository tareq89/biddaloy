import { randomUUID } from 'crypto';
import supertest = require('supertest');
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import {
  SEED_ACADEMIC_YEAR_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_TENANT_ID,
} from '@test/constants';
import { ensureFeeStructure, periodStart } from '@test/helpers/fee-fixture.helper';
import {
  createTeacherScopeFixture,
  TeacherScopeFixture,
} from '@test/helpers/teacher-scope.fixture';

export interface TestUser {
  id: string;
  token: string;
}

/**
 * Shared by the proof-submit integration and e2e specs: proofs switched on (bKash), a PARENT
 * linked to student A, a second PARENT linked to student B only, and a STUDENT-role user.
 * Call `reset()` in beforeEach (new students and bills), `cleanup()` in afterAll.
 */
export async function createProofFixture(app: INestApplication, ds: DataSource) {
  const tag = randomUUID().slice(0, 8);
  const [{ settings: saved }] = await ds.query(`SELECT settings FROM schools WHERE id = $1`, [
    SEED_TENANT_ID,
  ]);
  await ds.query(
    `UPDATE schools SET settings = COALESCE(settings,'{}'::jsonb) || jsonb_build_object('payments',
       jsonb_build_object('proofEnabled', true, 'proofMethods',
         jsonb_build_array(jsonb_build_object('method','BKASH','instructions','Send to 017'))))
     WHERE id = $1`,
    [SEED_TENANT_ID],
  );
  const fx: TeacherScopeFixture = await createTeacherScopeFixture(app, ds);

  const makeUser = async (label: string, role: UserRole): Promise<TestUser> => {
    const email = `proof-${label}-${tag}@e2e.example`;
    const [u] = await ds.query(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1,$2,'Proof User','ACTIVE',NOW(),NOW()) RETURNING id`,
      [email, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [u.id, SEED_TENANT_ID, role],
    );
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return { id: u.id, token: res.body.access_token };
  };
  const parent = await makeUser('parent', UserRole.PARENT);
  const other = await makeUser('other', UserRole.PARENT);
  const student = await makeUser('student', UserRole.STUDENT);
  const users = [parent.id, other.id, student.id];

  let n = 0;
  const wipe = async () => {
    await ds.query(`DELETE FROM payment_submissions WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(
      `DELETE FROM student_fees WHERE student_id IN (SELECT id FROM students WHERE tenant_id = $1)`,
      [SEED_TENANT_ID],
    );
  };

  return {
    fx,
    parent,
    other,
    student,
    /** Fresh students; parent is linked to A, other to B. */
    async reset() {
      await wipe();
      await fx.seed();
      await ds.query(`UPDATE guardians SET user_id = NULL WHERE user_id = ANY($1)`, [users]);
      await ds.query(`UPDATE guardians SET user_id = $1 WHERE id = $2`, [parent.id, fx.guardianA]);
      await ds.query(`UPDATE guardians SET user_id = $1 WHERE id = $2`, [other.id, fx.guardianB]);
    },
    /** Links the parent to student B as well (a second child). */
    async linkParentTo(studentId: string) {
      await ds.query(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`, [
        studentId,
        fx.guardianA,
      ]);
    },
    /** An open bill: total `total`, `paid` already paid. Balance = total - paid. */
    async bill(studentId: string, total: number, paid = 0, status = 'PENDING'): Promise<string> {
      const structure = await ensureFeeStructure(ds);
      n += 1;
      const [r] = await ds.query(
        `INSERT INTO student_fees (student_id, academic_year_id, fee_structure_id, period_start,
           total_amount, paid_amount, discount_amount, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4::date,$5,$6,0,$7,NOW(),NOW()) RETURNING id`,
        [
          studentId,
          SEED_ACADEMIC_YEAR_ID,
          structure,
          periodStart((n % 12) + 1, 2000 + n),
          total,
          paid,
          status,
        ],
      );
      return r.id;
    },
    async cleanup() {
      await wipe();
      await ds.query(`UPDATE guardians SET user_id = NULL WHERE user_id = ANY($1)`, [users]);
      await ds.query(`DELETE FROM user_tenants WHERE user_id = ANY($1)`, [users]);
      // Users stay: audit_logs rows reference them and the table is write-only.
      await ds.query(`UPDATE schools SET settings = $2 WHERE id = $1`, [SEED_TENANT_ID, saved]);
      await fx.cleanup();
    },
  };
}

/** Smallest valid JPEG/PDF bodies for the signature check. */
export const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
export const PDF = Buffer.from('%PDF-1.4 test');
