import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from './validation-pipe';
import { UserRole, CommunicationMedium } from '@biddaloy/shared';
import { Guardian } from './modules/students/entities/guardian.entity';
import { addressForMedium } from './modules/communications/reminder-recipients.util';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/**
 * [5.4a] Self-service profile.
 *
 * Two families of route, one rule: **the record you touch is chosen by your
 * JWT, never by anything you send.**
 *
 * ```
 *   PATCH /users/me      ─┐
 *   GET   /users/me       │   id := jwt.sub          (no id in the path)
 *   GET   /guardians/mine │   guardian := WHERE user_id = jwt.sub
 *   PATCH /guardians/mine ─┘                AND tenant_id = X-Tenant-ID
 * ```
 *
 * The cast:
 *
 * | user    | tenant A     | tenant B | guardian row        |
 * |---------|--------------|----------|---------------------|
 * | parent  | PARENT       | PARENT   | yes, in tenant A    |
 * | lonely  | PARENT       | —        | none                |
 * | student | STUDENT      | —        | none (links via students.user_id) |
 * | admin   | ADMIN (seed) | ADMIN    | n/a                 |
 *
 * `parent` holding a genuine membership in both tenants is the point of the
 * cross-tenant block: ContextGuard admits them to tenant B, so anything that
 * leaks their tenant-A guardian row under `X-Tenant-ID: B` is the query
 * layer failing, not the guard.
 */

const API = '/api/v1';

/**
 * Biddaloy's RolesGuard answers a role refusal with `UnauthorizedException`
 * (`context.guard.ts:139`), so a role-denied route is a **401**, not a 403.
 * Named here so the refusal assertions below read as intent rather than as
 * a typo.
 */
const ROLE_DENIED = 401;

const TENANT_B = '00000000-0000-4000-8000-0000054a0001';

const PARENT_USER_ID = '00000000-0000-4000-8000-0000054a0010';
const LONELY_USER_ID = '00000000-0000-4000-8000-0000054a0011';
const STUDENT_USER_ID = '00000000-0000-4000-8000-0000054a0012';

const PARENT_EMAIL = 'profile-parent@e2e.example';
const LONELY_EMAIL = 'profile-lonely@e2e.example';
const STUDENT_EMAIL = 'profile-student@e2e.example';

describe('[5.4a] Self-service profile', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let adminToken: string;
  let parentToken: string;
  let lonelyToken: string;
  let studentToken: string;

  let parentGuardianId: string;

  const http = () => supertest(app.getHttpServer());

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
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

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Profile Tenant B', 'profile-tenant-b', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );

    const accounts: Array<[string, string, string]> = [
      [PARENT_USER_ID, PARENT_EMAIL, 'Profile Parent'],
      [LONELY_USER_ID, LONELY_EMAIL, 'Parent Without Guardian Row'],
      [STUDENT_USER_ID, STUDENT_EMAIL, 'Profile Student'],
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
      // A real second membership — the guard will let them into tenant B.
      [PARENT_USER_ID, TENANT_B, UserRole.PARENT],
      [LONELY_USER_ID, SEED_TENANT_ID, UserRole.PARENT],
      [STUDENT_USER_ID, SEED_TENANT_ID, UserRole.STUDENT],
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
    lonelyToken = await login(LONELY_EMAIL);
    studentToken = await login(STUDENT_EMAIL);
  }, 120000);

  /**
   * `test/setup.ts` TRUNCATEs transactional tables (guardians, students, …)
   * before every test, so the guardian row is rebuilt here. Users, schools
   * and memberships survive and are built once above.
   */
  beforeEach(async () => {
    const rows = await dataSource.query(
      `INSERT INTO guardians (full_name, relationship, phone, alternate_phone, email,
                              tenant_id, user_id, preferred_communication,
                              is_primary_contact, created_at, updated_at)
       VALUES ('Profile Parent', 'FATHER', '+8801700000001', '+8801700000002',
               'guardian-a@e2e.example', $1, $2, 'SMS', true, NOW(), NOW())
       RETURNING id`,
      [SEED_TENANT_ID, PARENT_USER_ID],
    );
    parentGuardianId = rows[0].id as string;

    // Reset the user rows the PATCH tests mutate, so order never matters.
    await dataSource.query(
      `UPDATE users SET email = $2, phone = NULL, full_name = 'Profile Parent' WHERE id = $1`,
      [PARENT_USER_ID, PARENT_EMAIL],
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  // ---------------------------------------------------------------- GET /users/me

  describe('GET /users/me', () => {
    it('returns the calling PARENT their own record, with their tenant role', async () => {
      const res = await http()
        .get(`${API}/users/me`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(res.body.id).toBe(PARENT_USER_ID);
      expect(res.body.email).toBe(PARENT_EMAIL);
      expect(res.body.role).toBe(UserRole.PARENT);
    });

    it('never serializes password_hash', async () => {
      const res = await http()
        .get(`${API}/users/me`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(res.body).not.toHaveProperty('password_hash');
    });

    it('works for a STUDENT too — self-read is not a staff privilege', async () => {
      const res = await http()
        .get(`${API}/users/me`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(res.body.id).toBe(STUDENT_USER_ID);
      expect(res.body.role).toBe(UserRole.STUDENT);
    });

    it('resolves `me` as the JWT subject, not as a user id in the path', async () => {
      // Regression pin for route ordering: if `users/me` were declared below
      // `users/:id`, Nest would capture "me" as an id (the param has no
      // ParseUUIDPipe) and this would 403/404/500 instead of 200.
      const res = await http()
        .get(`${API}/users/me`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);
      expect(res.body.id).toBe(PARENT_USER_ID);
    });
  });

  // -------------------------------------------------------------- PATCH /users/me

  describe('PATCH /users/me', () => {
    // Business-critical: these must be REJECTED, not silently dropped, so a
    // client never believes a privilege change succeeded.
    const expectSelfAssignRejected = async (body: Record<string, unknown>) => {
      const snapshot = () =>
        dataSource.query(
          `SELECT u.full_name, u.status, u.email, u.phone, ut.role FROM users u
             JOIN user_tenants ut ON ut.user_id = u.id AND ut.tenant_id = $2
            WHERE u.id = $1`,
          [PARENT_USER_ID, SEED_TENANT_ID],
        );

      const before = await snapshot();

      await http()
        .patch(`${API}/users/me`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send(body)
        .expect(400);

      expect((await snapshot())[0]).toEqual(before[0]);
    };

    it('rejects a self-assigned "role" with 400 and changes nothing', async () => {
      await expectSelfAssignRejected({ role: UserRole.ADMIN });
    });

    it('rejects a self-assigned "status" with 400 and changes nothing', async () => {
      await expectSelfAssignRejected({ status: 'SUSPENDED' });
    });

    it('rejects a self-assigned "password_hash" with 400 and changes nothing', async () => {
      await expectSelfAssignRejected({ password_hash: 'pwned' });
    });

    it('rejects a self-assigned "tenantId" with 400 and changes nothing', async () => {
      await expectSelfAssignRejected({ tenantId: TENANT_B });
    });

    it('rejects a self-assigned "id" with 400 and changes nothing', async () => {
      await expectSelfAssignRejected({ id: SEED_ADMIN_USER_ID });
    });

    // ── [12.7] contract change: email/phone no longer live here ─────────
    //
    // `PATCH /users/me` stopped accepting `email`/`phone` entirely — the
    // commit-on-verify `ContactChangeService` flow
    // (`POST /users/me/contact-change`) is now the only way to change
    // either for yourself. `UpdateOwnProfileDto` no longer declares either
    // field (or `current_password`, which existed only to gate them), so
    // `forbidNonWhitelisted` rejects both exactly like the self-assign
    // cases above.
    it('rejects "email" with 400 and changes nothing — use POST /users/me/contact-change', async () => {
      await expectSelfAssignRejected({ email: 'hijacked@e2e.example' });
    });

    it('rejects "phone" with 400 and changes nothing — use POST /users/me/contact-change', async () => {
      await expectSelfAssignRejected({ phone: '+8801816666666' });
    });

    it('rejects "current_password" with 400 — the field no longer exists on this DTO', async () => {
      await expectSelfAssignRejected({ current_password: SEED_ADMIN_PASSWORD });
    });

    // The admin route is untouched by this contract change — only the
    // caller's own `/users/me` lost email/phone.
    it('still round-trips a valid BD phone through the admin PATCH /users/:id', async () => {
      const res = await http()
        .patch(`${API}/users/${PARENT_USER_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ phone: '01812345678' })
        .expect(200);

      expect(res.body.phone).toBe('01812345678');
      const rows = await dataSource.query(`SELECT phone FROM users WHERE id = $1`, [
        PARENT_USER_ID,
      ]);
      expect(rows[0].phone).toBe('01812345678');
    });

    it('leaves a cosmetic-only change friction-free', async () => {
      await http()
        .patch(`${API}/users/me`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ full_name: 'Renamed Parent' })
        .expect(200);

      const rows = await dataSource.query(`SELECT full_name FROM users WHERE id = $1`, [
        PARENT_USER_ID,
      ]);
      expect(rows[0].full_name).toBe('Renamed Parent');
    });

    it('does not accept current_password on the ADMIN route (different trust model)', async () => {
      // forbidNonWhitelisted: the admin DTO has no such field.
      await http()
        .patch(`${API}/users/${PARENT_USER_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ phone: '+8801817777777', current_password: SEED_ADMIN_PASSWORD })
        .expect(400);

      // ...and an admin still changes someone else's identifier with no
      // password at all.
      await http()
        .patch(`${API}/users/${PARENT_USER_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ phone: '+8801817777777' })
        .expect(200);
    });
  });

  // ------------------------------------------------- no reading/editing anyone else

  describe('no route lets a user reach another user', () => {
    it('PARENT cannot GET /users/:id for another user', async () => {
      await http()
        .get(`${API}/users/${SEED_ADMIN_USER_ID}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(ROLE_DENIED);
    });

    it('PARENT cannot GET /users/:id even for their OWN id (staff route stays staff)', async () => {
      await http()
        .get(`${API}/users/${PARENT_USER_ID}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(ROLE_DENIED);
    });

    it('PARENT cannot PATCH /users/:id for another user', async () => {
      await http()
        .patch(`${API}/users/${SEED_ADMIN_USER_ID}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ full_name: 'Owned' })
        .expect(ROLE_DENIED);

      const rows = await dataSource.query(`SELECT full_name FROM users WHERE id = $1`, [
        SEED_ADMIN_USER_ID,
      ]);
      expect(rows[0].full_name).not.toBe('Owned');
    });
  });

  // --------------------------------------------------------- /guardians/mine

  describe('GET /guardians/mine', () => {
    it('returns the guardian row linked to the calling PARENT', async () => {
      const res = await http()
        .get(`${API}/guardians/mine`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      expect(res.body.id).toBe(parentGuardianId);
      expect(res.body.user_id).toBe(PARENT_USER_ID);
    });

    it('refuses a STUDENT by role — students link via students.user_id, not a guardian row', async () => {
      await http()
        .get(`${API}/guardians/mine`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(ROLE_DENIED);
    });

    it('404s for a PARENT with no guardian record', async () => {
      await http()
        .get(`${API}/guardians/mine`)
        .set('Authorization', `Bearer ${lonelyToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(404);
    });

    it('404s once the guardian row is soft-deleted', async () => {
      await dataSource.query(`UPDATE guardians SET deleted_at = NOW() WHERE id = $1`, [
        parentGuardianId,
      ]);
      await http()
        .get(`${API}/guardians/mine`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(404);
    });
  });

  describe('PATCH /guardians/mine', () => {
    it('persists every self-editable contact field', async () => {
      await http()
        .patch(`${API}/guardians/mine`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({
          phone: '+8801911111111',
          alternate_phone: '+8801922222222',
          email: 'new-guardian@e2e.example',
          preferred_communication: CommunicationMedium.EMAIL,
        })
        .expect(200);

      const rows = await dataSource.query(
        `SELECT phone, alternate_phone, email, preferred_communication
           FROM guardians WHERE id = $1`,
        [parentGuardianId],
      );
      expect(rows[0]).toMatchObject({
        phone: '+8801911111111',
        alternate_phone: '+8801922222222',
        email: 'new-guardian@e2e.example',
        preferred_communication: CommunicationMedium.EMAIL,
      });
    });

    it("maps '' to a real NULL rather than storing an empty string", async () => {
      await http()
        .patch(`${API}/guardians/mine`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ alternate_phone: '', email: '' })
        .expect(200);

      const rows = await dataSource.query(
        `SELECT alternate_phone, email FROM guardians WHERE id = $1`,
        [parentGuardianId],
      );
      expect(rows[0].alternate_phone).toBeNull();
      expect(rows[0].email).toBeNull();
    });

    // The motivating story: a stale phone number silently stops fee
    // reminders. After the self-edit, the reminder path must dial the NEW
    // number — asserted against the very helper the dispatcher uses.
    it('changes the number fee reminders will dial', async () => {
      await http()
        .patch(`${API}/guardians/mine`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ phone: '+8801955555555' })
        .expect(200);

      const guardian = await dataSource
        .getRepository(Guardian)
        .findOneOrFail({ where: { id: parentGuardianId } });

      expect(addressForMedium(guardian, CommunicationMedium.SMS)).toBe('+8801955555555');
    });

    const expectGuardianFieldRejected = async (body: Record<string, unknown>) => {
      const snapshot = () =>
        dataSource.query(
          `SELECT full_name, relationship, tenant_id, user_id, is_primary_contact
             FROM guardians WHERE id = $1`,
          [parentGuardianId],
        );

      const before = await snapshot();

      await http()
        .patch(`${API}/guardians/mine`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send(body)
        .expect(400);

      expect((await snapshot())[0]).toEqual(before[0]);
    };

    it('rejects "full_name" with 400 and changes nothing', async () => {
      await expectGuardianFieldRejected({ full_name: 'Renamed Self' });
    });

    it('rejects "relationship" with 400 and changes nothing', async () => {
      await expectGuardianFieldRejected({ relationship: 'MOTHER' });
    });

    // The escalation this narrow DTO exists to prevent: relinking yourself.
    it('rejects "is_primary_contact" with 400 and changes nothing', async () => {
      await expectGuardianFieldRejected({ is_primary_contact: false });
    });

    it('rejects "tenant_id" with 400 and changes nothing', async () => {
      await expectGuardianFieldRejected({ tenant_id: TENANT_B });
    });

    it('rejects "user_id" with 400 and changes nothing', async () => {
      await expectGuardianFieldRejected({ user_id: SEED_ADMIN_USER_ID });
    });

    it('refuses a STUDENT by role', async () => {
      await http()
        .patch(`${API}/guardians/mine`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ phone: '+8801933333333' })
        .expect(ROLE_DENIED);
    });

    it('404s for a PARENT with no guardian record — and creates nothing', async () => {
      await http()
        .patch(`${API}/guardians/mine`)
        .set('Authorization', `Bearer ${lonelyToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ phone: '+8801944444444' })
        .expect(404);

      const rows = await dataSource.query(`SELECT id FROM guardians WHERE user_id = $1`, [
        LONELY_USER_ID,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('resolves `mine` as the JWT subject, not as a guardian id in the path', async () => {
      // Route-ordering pin: PATCH /guardians/:id has a bare @Param('id').
      await http()
        .patch(`${API}/guardians/mine`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ phone: '+8801966666666' })
        .expect(200);
    });

    it('does not widen the staff-only PATCH /guardians/:id route', async () => {
      await http()
        .patch(`${API}/guardians/${parentGuardianId}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ full_name: 'Owned' })
        .expect(ROLE_DENIED);
    });
  });

  // ------------------------------------------------------------- tenant context

  describe('tenant context', () => {
    // Every self-service route must refuse to act without a trustworthy
    // tenant context. `[400, 401, 403]` because which of the three the guard
    // picks is not the contract — only that the request does not succeed.
    type Method = 'get' | 'patch';

    const callWithoutTenant = (method: Method, path: string) =>
      (http() as any)[method](path).set('Authorization', `Bearer ${parentToken}`).send({});

    const callWithGarbageTenant = (method: Method, path: string) =>
      (http() as any)
        [method](path)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', 'not-a-uuid')
        .send({});

    // A real tenant the caller has no membership in. Deliberately the LONELY
    // parent and not the student: the student would be turned away by the
    // ROLE guard on /guardians/mine (PARENT-only) before the tenant was ever
    // considered, so the assertion would pass without proving anything about
    // tenant handling. The lonely parent holds PARENT — the right role for
    // every route here — and a membership in the seed tenant only, so a
    // rejection can only be about TENANT_B.
    const callWithForeignTenant = (method: Method, path: string) =>
      (http() as any)
        [method](path)
        .set('Authorization', `Bearer ${lonelyToken}`)
        .set('X-Tenant-ID', TENANT_B)
        .send({});

    const expectRejected = async (res: { status: number }) => {
      expect([400, 401, 403]).toContain(res.status);
    };

    it('GET /users/me rejects a missing X-Tenant-ID', async () => {
      await expectRejected(await callWithoutTenant('get', `${API}/users/me`));
    });

    it('GET /users/me rejects a garbage X-Tenant-ID', async () => {
      await expectRejected(await callWithGarbageTenant('get', `${API}/users/me`));
    });

    it('GET /users/me rejects a tenant the caller is not a member of', async () => {
      await expectRejected(await callWithForeignTenant('get', `${API}/users/me`));
    });

    it('PATCH /users/me rejects a missing X-Tenant-ID', async () => {
      await expectRejected(await callWithoutTenant('patch', `${API}/users/me`));
    });

    it('PATCH /users/me rejects a garbage X-Tenant-ID', async () => {
      await expectRejected(await callWithGarbageTenant('patch', `${API}/users/me`));
    });

    it('PATCH /users/me rejects a tenant the caller is not a member of', async () => {
      await expectRejected(await callWithForeignTenant('patch', `${API}/users/me`));
    });

    it('GET /guardians/mine rejects a missing X-Tenant-ID', async () => {
      await expectRejected(await callWithoutTenant('get', `${API}/guardians/mine`));
    });

    it('GET /guardians/mine rejects a garbage X-Tenant-ID', async () => {
      await expectRejected(await callWithGarbageTenant('get', `${API}/guardians/mine`));
    });

    it('GET /guardians/mine rejects a tenant the caller is not a member of', async () => {
      await expectRejected(await callWithForeignTenant('get', `${API}/guardians/mine`));
    });

    it('PATCH /guardians/mine rejects a missing X-Tenant-ID', async () => {
      await expectRejected(await callWithoutTenant('patch', `${API}/guardians/mine`));
    });

    it('PATCH /guardians/mine rejects a garbage X-Tenant-ID', async () => {
      await expectRejected(await callWithGarbageTenant('patch', `${API}/guardians/mine`));
    });

    it('PATCH /guardians/mine rejects a tenant the caller is not a member of', async () => {
      await expectRejected(await callWithForeignTenant('patch', `${API}/guardians/mine`));
    });

    it('does not leak the tenant-A guardian row under X-Tenant-ID: B', async () => {
      // The parent holds a genuine PARENT membership in tenant B, so the
      // guard admits them. Guardian.user_id is a global @OneToOne, so the
      // ONLY thing keeping tenant B from seeing this row is the tenant_id
      // filter in findOwn.
      await http()
        .get(`${API}/guardians/mine`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', TENANT_B)
        .expect(404);
    });

    it('cannot edit the tenant-A guardian row under X-Tenant-ID: B', async () => {
      await http()
        .patch(`${API}/guardians/mine`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', TENANT_B)
        .send({ phone: '+8801977777777' })
        .expect(404);

      const rows = await dataSource.query(`SELECT phone FROM guardians WHERE id = $1`, [
        parentGuardianId,
      ]);
      expect(rows[0].phone).toBe('+8801700000001');
    });

    it('GET /users/me under a tenant the caller does belong to returns that tenant role', async () => {
      const res = await http()
        .get(`${API}/users/me`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_B)
        .expect(200);

      expect(res.body.id).toBe(SEED_ADMIN_USER_ID);
      expect(res.body.role).toBe(UserRole.ADMIN);
    });
  });
});
