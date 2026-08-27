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
    it('persists a phone change made by the caller on themselves', async () => {
      await http()
        .patch(`${API}/users/me`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ phone: '+8801900000001' })
        .expect(200);

      const rows = await dataSource.query(`SELECT phone FROM users WHERE id = $1`, [
        PARENT_USER_ID,
      ]);
      expect(rows[0].phone).toBe('+8801900000001');
    });

    // Business-critical: these must be REJECTED, not silently dropped, so a
    // client never believes a privilege change succeeded.
    const FORBIDDEN_BODIES: Array<[string, Record<string, unknown>]> = [
      ['role', { role: UserRole.ADMIN }],
      ['status', { status: 'SUSPENDED' }],
      ['password_hash', { password_hash: 'pwned' }],
      ['tenantId', { tenantId: TENANT_B }],
      ['id', { id: SEED_ADMIN_USER_ID }],
    ];

    for (const [field, body] of FORBIDDEN_BODIES) {
      it(`rejects a self-assigned "${field}" with 400 and changes nothing`, async () => {
        const before = await dataSource.query(
          `SELECT u.full_name, u.status, ut.role FROM users u
             JOIN user_tenants ut ON ut.user_id = u.id AND ut.tenant_id = $2
            WHERE u.id = $1`,
          [PARENT_USER_ID, SEED_TENANT_ID],
        );

        await http()
          .patch(`${API}/users/me`)
          .set('Authorization', `Bearer ${parentToken}`)
          .set('X-Tenant-ID', SEED_TENANT_ID)
          .send(body)
          .expect(400);

        const after = await dataSource.query(
          `SELECT u.full_name, u.status, ut.role FROM users u
             JOIN user_tenants ut ON ut.user_id = u.id AND ut.tenant_id = $2
            WHERE u.id = $1`,
          [PARENT_USER_ID, SEED_TENANT_ID],
        );
        expect(after[0]).toEqual(before[0]);
      });
    }

    it('returns 409, not 500, when the email already belongs to someone else', async () => {
      const res = await http()
        .patch(`${API}/users/me`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ email: SEED_ADMIN_EMAIL })
        .expect(409);

      // The message must not name the other account's tenant or owner —
      // email/phone are globally unique, so that would be a cross-tenant leak.
      expect(res.body.message).not.toContain(TENANT_B);
      expect(res.body.message).not.toContain(SEED_ADMIN_USER_ID);
    });

    it("accepts re-submitting the caller's own email unchanged", async () => {
      await http()
        .patch(`${API}/users/me`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ email: PARENT_EMAIL })
        .expect(200);
    });

    // ── phone: '' means "clear it" ───────────────────────────────────────
    //
    // A browser form submits a cleared input as `''`, and `users.phone`
    // carries a GLOBAL unique index. `''` is a real value to that index, so
    // writing it instead of NULL means only ONE account in the entire system
    // can hold a "blank" phone — the second user to clear theirs used to get
    // a raw 500.

    it("clears the phone and stores a real NULL when sent phone: ''", async () => {
      await dataSource.query(`UPDATE users SET phone = '+8801811111111' WHERE id = $1`, [
        PARENT_USER_ID,
      ]);

      await http()
        .patch(`${API}/users/me`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ phone: '' })
        .expect(200);

      const rows = await dataSource.query(`SELECT phone FROM users WHERE id = $1`, [
        PARENT_USER_ID,
      ]);
      // Must be NULL, not `''` — see the note above.
      expect(rows[0].phone).toBeNull();
    });

    it('lets TWO different users each clear their phone (the exact case that used to 500)', async () => {
      await dataSource.query(`UPDATE users SET phone = '+8801812222222' WHERE id = $1`, [
        PARENT_USER_ID,
      ]);
      await dataSource.query(`UPDATE users SET phone = '+8801813333333' WHERE id = $1`, [
        LONELY_USER_ID,
      ]);

      await http()
        .patch(`${API}/users/me`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ phone: '' })
        .expect(200);

      // The second clear is the one that hit the unique index on `''`.
      await http()
        .patch(`${API}/users/me`)
        .set('Authorization', `Bearer ${lonelyToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ phone: '' })
        .expect(200);

      const rows = await dataSource.query(
        `SELECT id, phone FROM users WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [[PARENT_USER_ID, LONELY_USER_ID]],
      );
      expect(rows.map((r: { phone: string | null }) => r.phone)).toEqual([null, null]);
    });

    // ── SECURITY: a phone must not be able to impersonate a login identifier ──
    //
    // `AuthService.validateUser` looks the caller up with
    // `where: [{ email: X }, { phone: X }]` — one OR'd lookup over BOTH
    // columns. So a user who set their *phone* to a victim's *email address*
    // would shadow that victim's login: the OR could resolve the victim's
    // own email to the attacker's row, and every failed attempt against it
    // would drive `recordFailure` on the wrong account, locking the victim
    // out. `@Matches(BD_PHONE_REGEX)` on the phone field is what closes it.
    it("rejects a phone that is really a victim's EMAIL ADDRESS, and leaves the victim's login intact", async () => {
      await http()
        .patch(`${API}/users/me`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ phone: SEED_ADMIN_EMAIL })
        .expect(400);

      // Nothing was written to the attacker's row...
      const rows = await dataSource.query(`SELECT phone FROM users WHERE id = $1`, [
        PARENT_USER_ID,
      ]);
      expect(rows[0].phone).toBeNull();

      // ...and the victim's email still logs the victim in, not the attacker.
      const victimToken = await login(SEED_ADMIN_EMAIL);
      const me = await http()
        .get(`${API}/users/me`)
        .set('Authorization', `Bearer ${victimToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);
      expect(me.body.id).toBe(SEED_ADMIN_USER_ID);
      expect(me.body.email).toBe(SEED_ADMIN_EMAIL);
    });

    it('rejects any other non-BD-format phone with 400', async () => {
      for (const phone of ['not-a-phone', '12345', '+15551234567']) {
        await http()
          .patch(`${API}/users/me`)
          .set('Authorization', `Bearer ${parentToken}`)
          .set('X-Tenant-ID', SEED_TENANT_ID)
          .send({ phone })
          .expect(400);
      }
    });

    // ── length: reject at the DTO, never let the varchar bounds 500 ──────
    //
    // `users.email` is varchar(100) and `users.phone` varchar(20); an
    // over-long value used to reach Postgres and come back as a 500.

    it('rejects an email longer than the varchar(100) column with 400, not 500', async () => {
      // Structurally a valid address — local part inside the 64-char RFC
      // limit and every domain label inside 63 — so `@IsEmail()` is happy
      // with it and `@MaxLength(100)` is the only thing standing between
      // this and the varchar(100) column.
      const tooLong = `${'a'.repeat(60)}@${'b'.repeat(50)}.example`;
      expect(tooLong.length).toBeGreaterThan(100);

      await http()
        .patch(`${API}/users/me`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ email: tooLong })
        .expect(400);

      const rows = await dataSource.query(`SELECT email FROM users WHERE id = $1`, [
        PARENT_USER_ID,
      ]);
      expect(rows[0].email).toBe(PARENT_EMAIL);
    });

    it('rejects a phone longer than the varchar(20) column with 400, not 500', async () => {
      const tooLong = `+880171234567890123456789`;
      expect(tooLong.length).toBeGreaterThan(20);

      await http()
        .patch(`${API}/users/me`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ phone: tooLong })
        .expect(400);
    });

    // ── the 409 body must not confirm the value it was handed ────────────
    //
    // email/phone are unique GLOBALLY, so echoing the submitted value back
    // turns the conflict into "yes, an account with this address exists
    // somewhere in the system" — an account-existence oracle.

    it('does not echo the submitted email back in the 409 body', async () => {
      const res = await http()
        .patch(`${API}/users/me`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ email: SEED_ADMIN_EMAIL })
        .expect(409);

      expect(JSON.stringify(res.body)).not.toContain(SEED_ADMIN_EMAIL);
    });

    it('does not echo the submitted phone back in the 409 body', async () => {
      const takenPhone = '+8801814444444';
      await dataSource.query(`UPDATE users SET phone = $2 WHERE id = $1`, [
        STUDENT_USER_ID,
        takenPhone,
      ]);

      const res = await http()
        .patch(`${API}/users/me`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ phone: takenPhone })
        .expect(409);

      expect(JSON.stringify(res.body)).not.toContain(takenPhone);

      await dataSource.query(`UPDATE users SET phone = NULL WHERE id = $1`, [STUDENT_USER_ID]);
    });

    // The tightened validation must not have cost the happy path: a real
    // Bangladeshi number still round-trips through both write routes.
    it('still round-trips a valid BD phone through PATCH /users/me', async () => {
      const res = await http()
        .patch(`${API}/users/me`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ phone: '01712345678' })
        .expect(200);

      expect(res.body.phone).toBe('01712345678');
      const rows = await dataSource.query(`SELECT phone FROM users WHERE id = $1`, [
        PARENT_USER_ID,
      ]);
      expect(rows[0].phone).toBe('01712345678');
    });

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

    const FORBIDDEN_GUARDIAN_BODIES: Array<[string, Record<string, unknown>]> = [
      ['full_name', { full_name: 'Renamed Self' }],
      ['relationship', { relationship: 'MOTHER' }],
      // The escalation this narrow DTO exists to prevent: relinking yourself
      // to arbitrary students.
      ['student_ids', { student_ids: ['00000000-0000-4000-8000-0000054a00ff'] }],
      ['is_primary_contact', { is_primary_contact: false }],
      ['tenant_id', { tenant_id: TENANT_B }],
      ['user_id', { user_id: SEED_ADMIN_USER_ID }],
    ];

    for (const [field, body] of FORBIDDEN_GUARDIAN_BODIES) {
      it(`rejects "${field}" with 400 and changes nothing`, async () => {
        const before = await dataSource.query(
          `SELECT full_name, relationship, tenant_id, user_id, is_primary_contact
             FROM guardians WHERE id = $1`,
          [parentGuardianId],
        );

        await http()
          .patch(`${API}/guardians/mine`)
          .set('Authorization', `Bearer ${parentToken}`)
          .set('X-Tenant-ID', SEED_TENANT_ID)
          .send(body)
          .expect(400);

        const after = await dataSource.query(
          `SELECT full_name, relationship, tenant_id, user_id, is_primary_contact
             FROM guardians WHERE id = $1`,
          [parentGuardianId],
        );
        expect(after[0]).toEqual(before[0]);
      });
    }

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
    const NEW_ROUTES: Array<[string, 'get' | 'patch', string]> = [
      ['GET /users/me', 'get', `${API}/users/me`],
      ['PATCH /users/me', 'patch', `${API}/users/me`],
      ['GET /guardians/mine', 'get', `${API}/guardians/mine`],
      ['PATCH /guardians/mine', 'patch', `${API}/guardians/mine`],
    ];

    for (const [name, method, path] of NEW_ROUTES) {
      it(`${name} rejects a missing X-Tenant-ID`, async () => {
        const res = await (http() as any)
          [method](path)
          .set('Authorization', `Bearer ${parentToken}`)
          .send({});
        expect([400, 401, 403]).toContain(res.status);
      });

      it(`${name} rejects a garbage X-Tenant-ID`, async () => {
        const res = await (http() as any)
          [method](path)
          .set('Authorization', `Bearer ${parentToken}`)
          .set('X-Tenant-ID', 'not-a-uuid')
          .send({});
        expect([400, 401, 403]).toContain(res.status);
      });

      it(`${name} rejects a tenant the caller is not a member of`, async () => {
        // A real tenant, but the parent has no membership beyond A and B —
        // use a well-formed id nobody granted them.
        const res = await (http() as any)
          [method](path)
          .set('Authorization', `Bearer ${studentToken}`)
          .set('X-Tenant-ID', TENANT_B)
          .send({});
        expect([400, 401, 403]).toContain(res.status);
      });
    }

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
