import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { UserRole, WalletTransactionKind } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_SECTION_1_ID,
} from '@test/constants';
import { WalletService } from './wallet.service';

/**
 * E2E tests for `GET /students/:id/wallet` (16.1.5).
 *
 * Covers the three things `FamilyAccessService` + `@RequirePermissions`
 * are supposed to guarantee on a family-scoped read route: a PARENT/STUDENT
 * only ever sees their own linked child's wallet, tenant isolation holds
 * even for a caller with a genuine membership in both tenants, and a role
 * without `FEE_READ` is refused outright.
 */

const API = '/api/v1';

const TENANT_B = '00000000-0000-4000-8000-0000005c0001';

const PARENT_USER_ID = '00000000-0000-4000-8000-0000005c0010';
const STRANGER_USER_ID = '00000000-0000-4000-8000-0000005c0011';

const PARENT_EMAIL = 'wallet-parent@e2e.example';
const STRANGER_EMAIL = 'wallet-stranger@e2e.example';

describe('GET /students/:id/wallet (16.1.5)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let walletService: WalletService;

  let adminToken: string;
  let parentToken: string;
  let strangerToken: string;

  let childId: string;
  let childInBId: string;

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  async function createStudent(tenantId: string, sectionId: string | null): Promise<string> {
    const res = await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, date_of_birth, preferred_communication, enrollment_status, created_at, updated_at)
       VALUES (DEFAULT, 'Wallet E2E Student', $1, floor(random() * 100000)::int, $2, $3, '2010-01-01', 'SMS', 'ACTIVE', NOW(), NOW())
       RETURNING id`,
      [`REG-WAL-E2E-${Math.random().toString(36).slice(2, 10)}`, sectionId, tenantId],
    );
    return res[0].id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);
    walletService = app.get(WalletService);

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Wallet E2E Tenant B', 'wallet-e2e-tenant-b', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );

    const accounts: Array<[string, string]> = [
      [PARENT_USER_ID, PARENT_EMAIL],
      [STRANGER_USER_ID, STRANGER_EMAIL],
    ];
    for (const [id, email] of accounts) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Wallet E2E User', 'ACTIVE', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH],
      );
    }

    const memberships: Array<[string, string, UserRole]> = [
      [PARENT_USER_ID, SEED_TENANT_ID, UserRole.PARENT],
      // Genuine second membership, so tenant-isolation failures below are
      // the service layer's fault, not ContextGuard refusing entry.
      [PARENT_USER_ID, TENANT_B, UserRole.PARENT],
      [STRANGER_USER_ID, SEED_TENANT_ID, UserRole.PARENT],
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
    strangerToken = await login(STRANGER_EMAIL);
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  /**
   * Rebuilt before every test: `test/setup.ts`'s global `beforeEach`
   * `DELETE`s/`TRUNCATE`s every transactional table — `students`,
   * `student_guardians`, `student_wallets`, `wallet_transactions`
   * included — between tests, so the seeded-once-in-`beforeAll` cast above
   * (schools/users/user_tenants, which survive that reset) can't carry
   * student/wallet fixtures across tests. See `family-read-api.e2e-spec.ts`
   * for the same pattern.
   */
  beforeEach(async () => {
    childId = await createStudent(SEED_TENANT_ID, SEED_SECTION_1_ID);
    // `students.class_section_id` is NOT NULL; nothing under test cares
    // about class-section data, so childInB reuses the same globally
    // seeded section despite belonging to a different tenant.
    childInBId = await createStudent(TENANT_B, SEED_SECTION_1_ID);

    await dataSource
      .createQueryBuilder()
      .insert()
      .into('student_guardians')
      .values(
        (
          await dataSource.query(
            `INSERT INTO guardians (id, full_name, relationship, phone, email, tenant_id, user_id, created_at, updated_at)
             VALUES (DEFAULT, 'Wallet E2E Parent', 'FATHER', '+8801700000099', $1, $2, $3, NOW(), NOW())
             RETURNING id`,
            [PARENT_EMAIL, SEED_TENANT_ID, PARENT_USER_ID],
          )
        ).map((g: { id: string }) => ({ student_id: childId, guardian_id: g.id })),
      )
      .execute();

    await dataSource.transaction(async (manager: EntityManager) => {
      await walletService.credit(
        {
          studentId: childId,
          tenantId: SEED_TENANT_ID,
          amount: 500,
          kind: WalletTransactionKind.CREDIT_OVERPAYMENT,
          note: 'Overpayment refund',
        },
        manager,
      );
    });
    await dataSource.transaction(async (manager: EntityManager) => {
      await walletService.credit(
        {
          studentId: childInBId,
          tenantId: TENANT_B,
          amount: 999,
          kind: WalletTransactionKind.CREDIT_OVERPAYMENT,
        },
        manager,
      );
    });
  });

  it('lets staff (ADMIN) see a student wallet balance and full transaction shape', async () => {
    const res = await supertest(app.getHttpServer())
      .get(`${API}/students/${childId}/wallet`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .expect(200);

    expect(Number(res.body.balance)).toBe(500);
    expect(res.body.transactions).toHaveLength(1);
    // Staff sees the raw entity — internal columns included.
    expect(res.body.transactions[0]).toHaveProperty('wallet_id');
    expect(res.body.transactions[0]).toHaveProperty('created_by_user_id');
  });

  it('lets a linked PARENT see only their own child, with the reduced family shape', async () => {
    const res = await supertest(app.getHttpServer())
      .get(`${API}/students/${childId}/wallet`)
      .set('Authorization', `Bearer ${parentToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.PARENT)
      .expect(200);

    expect(Number(res.body.balance)).toBe(500);
    expect(res.body.transactions).toHaveLength(1);
    expect(Number(res.body.transactions[0].amount)).toBe(500);
    expect(res.body.transactions[0].kind).toBe(WalletTransactionKind.CREDIT_OVERPAYMENT);
    expect(res.body.transactions[0].note).toBe('Overpayment refund');
    expect(res.body.transactions[0]).toHaveProperty('created_at');
    // Allow-list enforced: exactly amount/kind/note/created_at, no internal
    // columns (wallet_id, tenant_id, payment_id, created_by_user_id, ...).
    expect(Object.keys(res.body.transactions[0]).sort()).toEqual(
      ['amount', 'kind', 'note', 'created_at'].sort(),
    );
  });

  it('refuses a PARENT who is not linked to the requested student', async () => {
    await supertest(app.getHttpServer())
      .get(`${API}/students/${childId}/wallet`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.PARENT)
      .expect(401);
  });

  it('keeps tenants isolated even for a caller with real membership in both', async () => {
    // The parent genuinely belongs to tenant B, but is not linked to
    // childInB there — and childInB's wallet must not be reachable from
    // tenant A regardless.
    await supertest(app.getHttpServer())
      .get(`${API}/students/${childInBId}/wallet`)
      .set('Authorization', `Bearer ${parentToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.PARENT)
      .expect(401);

    await supertest(app.getHttpServer())
      .get(`${API}/students/${childInBId}/wallet`)
      .set('Authorization', `Bearer ${parentToken}`)
      .set('X-Tenant-ID', TENANT_B)
      .set('X-Role', UserRole.PARENT)
      .expect(401); // genuinely not linked to childInB in tenant B either
  });

  it('rejects a role the caller has no membership for', async () => {
    // Every real UserRole is listed in the route's own @Roles(), and every
    // one of them carries FEE_READ in the permission matrix — so the only
    // way this route ever refuses a request on role/permission grounds is
    // a role the caller doesn't actually hold in this tenant. The admin
    // token's only membership is ADMIN, so an explicit X-Role it was never
    // granted must be refused before the family-linkage check even runs.
    await supertest(app.getHttpServer())
      .get(`${API}/students/${childId}/wallet`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.SUPER_ADMIN)
      .expect(401);
  });
});
