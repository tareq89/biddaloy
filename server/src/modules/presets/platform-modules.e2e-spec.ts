import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { authenticator } from 'otplib';
import { ApprovalScope, DEV_COCKPIT_TOTP_SECRET, ModuleKey } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { mintCockpitToken, removeCockpitOwners } from '@test/helpers/cockpit-token.helper';
import { setModules } from '@test/helpers/modules.helper';
import { SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_TENANT_ID } from '@test/constants';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { MODULE_OFF_MESSAGE } from '../../common/filters/known-errors';
import { ModuleStateReader } from '../auth/guards/module-state.reader';
import { MfaService } from '../auth/mfa/mfa.service';
import { PlatformHomeService } from '../platform-identity/platform-home.service';
import { PlatformSetting } from '../platform-identity/entities/platform-setting.entity';

/**
 * [77.6.01] Platform module switches and per-school locks over real HTTP and the real guard.
 * Precedence: platform off > platform lock > school choice. Turning a platform switch back on
 * returns each school to its own choice (the school rows are never written by the global map).
 */
describe('[77.6.01] platform modules E2E', () => {
  const API = '/api/v1';
  // A route tagged `homework` in the route snapshot; the seeded ADMIN reaches it when on.
  const HOMEWORK = `${API}/homework`;
  let app: INestApplication;
  let ds: DataSource;
  let cockpit: string;
  let ownerId: string;
  let schoolToken: string;
  const otherSchool = randomUUID();

  const decodeSub = (jwt: string) =>
    JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).sub as string;
  const totp = authenticator.clone({ digits: 6, step: 30, window: 1 });
  const http = () => supertest(app.getHttpServer());

  async function approval(): Promise<string> {
    // The real cockpit step-up endpoint, same owner as the write. A TOTP step is single-use.
    await ds.query(`UPDATE user_mfa SET last_step = NULL WHERE user_id = $1`, [ownerId]);
    const res = await http()
      .post(`${API}/platform/step-up`)
      .set(owner())
      .send({
        scope: ApprovalScope.PLATFORM_SCHOOL_CONTROL,
        code: totp.generate(DEV_COCKPIT_TOTP_SECRET),
      })
      .expect(200);
    return res.body.approval_token;
  }
  const owner = () => ({ Authorization: `Bearer ${cockpit}` });
  async function putModules(modules: unknown) {
    return http()
      .put(`${API}/platform/modules`)
      .set(owner())
      .set('X-Approval-Token', await approval())
      .send({ modules });
  }
  async function putLock(schoolId: string, key: string, lock: unknown) {
    return http()
      .put(`${API}/platform/schools/${schoolId}/modules/${key}/lock`)
      .set(owner())
      .set('X-Approval-Token', await approval())
      .send({ lock });
  }
  const homework = () =>
    http()
      .get(HOMEWORK)
      .set('Authorization', `Bearer ${schoolToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID);
  const settingsOf = async (id: string) =>
    (await ds.query(`SELECT settings FROM schools WHERE id = $1`, [id]))[0].settings;
  const auditCount = async (action: string) =>
    Number(
      (await ds.query(`SELECT COUNT(*) FROM audit_logs WHERE action = $1`, [action]))[0].count,
    );

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
    await app.get(PlatformHomeService).ensure();
    cockpit = await mintCockpitToken(app, ds);
    ownerId = decodeSub(cockpit);
    await app.get(MfaService).enrolWithKnownSecret(ownerId, DEV_COCKPIT_TOTP_SECRET);
    const login = await http()
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    schoolToken = login.body.access_token;
    await ds.query(
      `INSERT INTO schools (id, name, slug, settings, created_at, updated_at)
       VALUES ($1, 'Lock B', $2, '{"modules":{"homework":{"on":true}},"labels":{}}'::jsonb, NOW(), NOW())`,
      [otherSchool, `lock-b-${otherSchool.slice(0, 8)}`],
    );
  }, 60000);

  afterEach(async () => {
    vi.restoreAllMocks();
    await ds.query(`DELETE FROM platform_settings WHERE key = 'modules'`);
    app.get(ModuleStateReader).invalidatePlatformModules();
    await setModules(app, SEED_TENANT_ID, { [ModuleKey.homework]: null });
    await ds.query(
      `UPDATE schools SET settings = settings #- '{modules,homework,lock}' WHERE id = $1`,
      [SEED_TENANT_ID],
    );
    app.get(ModuleStateReader).invalidatePlatformModules();
  });

  afterAll(async () => {
    if (app) {
      await ds.query(`DELETE FROM schools WHERE id = $1`, [otherSchool]);
      await removeCockpitOwners(ds);
      await app.close();
    }
  });

  describe('global map', () => {
    it('owner reads an empty map, writes it, reads it back, and the write is audited', async () => {
      const before = await auditCount('PLATFORM_MODULES_UPDATED');
      expect((await http().get(`${API}/platform/modules`).set(owner()).expect(200)).body).toEqual({
        modules: {},
      });
      await putModules({ homework: false }).then((r) => expect(r.status).toBe(200));
      expect((await http().get(`${API}/platform/modules`).set(owner()).expect(200)).body).toEqual({
        modules: { homework: false },
      });
      expect(await auditCount('PLATFORM_MODULES_UPDATED')).toBe(before + 1);
    });

    it('platform off closes the school route with the fixed sentence; on again restores the school choice', async () => {
      await homework().expect(200);
      await putModules({ homework: false }).then((r) => expect(r.status).toBe(200));
      const res = await homework().expect(403);
      expect(res.body.message).toBe(MODULE_OFF_MESSAGE);

      // The school switched it off itself: after platform ON the school's own choice still holds.
      await setModules(app, SEED_TENANT_ID, { homework: { on: false } });
      await putModules({}).then((r) => expect(r.status).toBe(200));
      expect((await homework().expect(403)).body.message).toBe(MODULE_OFF_MESSAGE);
      expect((await settingsOf(SEED_TENANT_ID)).modules.homework).toEqual({ on: false });
      await setModules(app, SEED_TENANT_ID, { homework: { on: true } });
      await homework().expect(200);
    });

    it('rejects bad maps with fixed text that never echoes the input', async () => {
      const unknown = await putModules({ 'secret-key-zzz': false });
      expect(unknown.status).toBe(400);
      expect(unknown.body.message).toBe('modules contains an unknown or core module');
      expect(JSON.stringify(unknown.body)).not.toContain('secret-key-zzz');
      const core = await putModules({ students: false });
      expect(core.status).toBe(400);
      const notBool = await putModules({ homework: 'no' });
      expect(notBool.status).toBe(400);
      expect(notBool.body.message).toBe('each module must be true or false');
      expect((await putModules([true])).status).toBe(400);
      expect((await putModules(undefined)).status).toBe(400);
    });

    it('a write without a step-up token is refused and changes nothing', async () => {
      await http()
        .put(`${API}/platform/modules`)
        .set(owner())
        .send({ modules: { homework: false } })
        .expect(403);
      expect((await http().get(`${API}/platform/modules`).set(owner())).body.modules).toEqual({});
    });

    it('fails closed when platform_settings cannot be read', async () => {
      app.get(ModuleStateReader).invalidatePlatformModules();
      const real = ds.getRepository.bind(ds);
      vi.spyOn(ds, 'getRepository').mockImplementation(((target: unknown) => {
        if (target === PlatformSetting) {
          return { findOne: () => Promise.reject(new Error('db down')) } as never;
        }
        return real(target as never);
      }) as never);
      const res = await homework();
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(res.status).not.toBe(200);
    });
  });

  describe('per-school lock', () => {
    it('lock off beats the school choice; lock on beats a school off; null gives control back; audited', async () => {
      const before = await auditCount('PLATFORM_MODULE_LOCK_UPDATED');
      await setModules(app, SEED_TENANT_ID, { homework: { on: true, offForRoles: [] } });
      const off = await putLock(SEED_TENANT_ID, 'homework', 'off');
      expect(off.status).toBe(200);
      expect(off.body).toEqual({ key: 'homework', lock: 'off' });
      expect((await homework().expect(403)).body.message).toBe(MODULE_OFF_MESSAGE);

      await putLock(SEED_TENANT_ID, 'homework', 'on').then((r) => expect(r.status).toBe(200));
      await setModules(app, SEED_TENANT_ID, { homework: { on: false } });
      await homework().expect(200); // lock on wins over the school's off

      await putLock(SEED_TENANT_ID, 'homework', null).then((r) => expect(r.status).toBe(200));
      await homework().expect(403); // control is back: the school's own off shows again
      expect(await auditCount('PLATFORM_MODULE_LOCK_UPDATED')).toBe(before + 3);
    });

    it('platform off still beats a lock on', async () => {
      await putLock(SEED_TENANT_ID, 'homework', 'on');
      await putModules({ homework: false });
      expect((await homework().expect(403)).body.message).toBe(MODULE_OFF_MESSAGE);
    });

    it('writes only modules.<key>.lock, keeps every other field, and leaves other schools alone', async () => {
      await setModules(app, SEED_TENANT_ID, {
        homework: { on: true, offForRoles: ['TEACHER'] as never },
      });
      const sibling = await settingsOf(otherSchool);
      const a = await settingsOf(SEED_TENANT_ID);
      await putLock(SEED_TENANT_ID, 'homework', 'on');
      const after = await settingsOf(SEED_TENANT_ID);
      expect(after.modules.homework).toEqual({ on: true, offForRoles: ['TEACHER'], lock: 'on' });
      expect({ ...after, modules: undefined }).toEqual({ ...a, modules: undefined });
      expect(await settingsOf(otherSchool)).toEqual(sibling);

      // Clearing removes just the lock key.
      await putLock(SEED_TENANT_ID, 'homework', null);
      expect((await settingsOf(SEED_TENANT_ID)).modules.homework).toEqual({
        on: true,
        offForRoles: ['TEACHER'],
      });
    });

    it('clearing a lock on a school that has no other entry fields removes the empty entry', async () => {
      await putLock(otherSchool, 'fees', 'off');
      expect((await settingsOf(otherSchool)).modules.fees).toEqual({ lock: 'off' });
      await putLock(otherSchool, 'fees', null);
      const s = await settingsOf(otherSchool);
      expect(s.modules.fees).toBeUndefined();
      expect(s.modules.homework).toEqual({ on: true });
    });

    it('a school admin cannot unset the lock, even by sending null for the module', async () => {
      await putLock(SEED_TENANT_ID, 'homework', 'off');
      // Same service call the school settings PATCH route makes.
      await setModules(app, SEED_TENANT_ID, { homework: null });
      expect((await settingsOf(SEED_TENANT_ID)).modules.homework.lock).toBe('off');
      await setModules(app, SEED_TENANT_ID, { homework: { on: true } });
      expect((await homework().expect(403)).body.message).toBe(MODULE_OFF_MESSAGE);
    });

    it('rejects an unknown or core key, a bad lock value and a bad school id with fixed text', async () => {
      const bad = await putLock(SEED_TENANT_ID, 'zzz-secret', 'on');
      expect(bad.status).toBe(400);
      expect(JSON.stringify(bad.body)).not.toContain('zzz-secret');
      expect((await putLock(SEED_TENANT_ID, 'students', 'on')).status).toBe(400);
      expect((await putLock(SEED_TENANT_ID, 'homework', 'maybe')).status).toBe(400);
      expect((await putLock(SEED_TENANT_ID, 'homework', undefined)).status).toBe(400);
      expect((await putLock('not-a-uuid', 'homework', 'on')).status).toBe(400);
      const missing = await putLock(randomUUID(), 'homework', 'on');
      expect(missing.status).toBe(404);
      expect(missing.body.message).toBe('School not found');
    });

    it('does not audit a lock that did not change', async () => {
      await putLock(SEED_TENANT_ID, 'homework', 'on');
      const n = await auditCount('PLATFORM_MODULE_LOCK_UPDATED');
      await putLock(SEED_TENANT_ID, 'homework', 'on');
      expect(await auditCount('PLATFORM_MODULE_LOCK_UPDATED')).toBe(n);
    });
  });

  describe('GET schools/:id/modules', () => {
    const read = (id: string) => http().get(`${API}/platform/schools/${id}/modules`).set(owner());

    it('returns on and lock per known key, drops offForRoles and unknown keys/fields', async () => {
      await setModules(app, SEED_TENANT_ID, { homework: { on: false, offForRoles: ['TEACHER'] } });
      await putLock(SEED_TENANT_ID, 'homework', 'on');
      await ds.query(
        `UPDATE schools SET settings = jsonb_set(settings, '{modules,zzz-secret}', '{"on":true}') WHERE id = $1`,
        [SEED_TENANT_ID],
      );
      let res: Awaited<ReturnType<typeof read>>;
      try {
        res = await read(SEED_TENANT_ID);
      } finally {
        await ds.query(
          `UPDATE schools SET settings = settings #- '{modules,zzz-secret}' WHERE id = $1`,
          [SEED_TENANT_ID],
        );
      }
      expect(res.status).toBe(200);
      expect(res.body.modules.homework).toEqual({ on: false, lock: 'on' });
      expect(JSON.stringify(res.body)).not.toContain('offForRoles');
      expect(JSON.stringify(res.body)).not.toContain('zzz-secret');
    });

    it("never returns another school's data; no modules block is an empty map", async () => {
      await putLock(SEED_TENANT_ID, 'homework', 'off');
      expect((await read(otherSchool)).body).toEqual({ modules: { homework: { on: true } } });
      const bare = randomUUID();
      await ds.query(
        `INSERT INTO schools (id, name, slug, settings, created_at, updated_at)
         VALUES ($1, 'Bare', $2, '{}'::jsonb, NOW(), NOW())`,
        [bare, `bare-${bare.slice(0, 8)}`],
      );
      const res = await read(bare);
      await ds.query(`DELETE FROM schools WHERE id = $1`, [bare]);
      expect(res.body).toEqual({ modules: {} });
    });

    it('unknown school is the fixed 404, a non-UUID id is 400', async () => {
      const missing = await read(randomUUID());
      expect(missing.status).toBe(404);
      expect(missing.body.message).toBe('School not found');
      expect((await read('not-a-uuid')).status).toBe(400);
    });
  });

  describe('who can call', () => {
    const routes: [string, string][] = [
      ['get', `${API}/platform/modules`],
      ['get', `${API}/platform/schools/${SEED_TENANT_ID}/modules`],
      ['put', `${API}/platform/modules`],
      ['put', `${API}/platform/schools/${SEED_TENANT_ID}/modules/homework/lock`],
    ];
    for (const [method, url] of routes) {
      it(`${method.toUpperCase()} ${url.replace(SEED_TENANT_ID, ':id')}: school ADMIN token is refused, no token is 401`, async () => {
        const asAdmin = await (http() as any)
          [method](url)
          .set('Authorization', `Bearer ${schoolToken}`)
          .set('X-Tenant-ID', SEED_TENANT_ID)
          .send({ modules: {}, lock: 'on' });
        expect([401, 403]).toContain(asAdmin.status);
        await (http() as any)[method](url).send({}).expect(401);
      });
    }
    it('a refused school admin write changed nothing', async () => {
      await (http() as any)
        .put(`${API}/platform/schools/${SEED_TENANT_ID}/modules/homework/lock`)
        .set('Authorization', `Bearer ${schoolToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ lock: 'off' });
      expect((await settingsOf(SEED_TENANT_ID)).modules?.homework?.lock).toBeUndefined();
    });
  });
});
