import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { MODULE_DEPENDENCIES, ModuleKey, UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { MODULE_OFF_MESSAGE } from '../../common/filters/known-errors';
import { setModules } from '@test/helpers/modules.helper';
import {
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_USER_ID,
  SEED_TENANT_ID,
} from '@test/constants';
import { ModuleStateReader } from './guards/module-state.reader';

/**
 * [77.2.10] Wave-2 close (D47). One representative read route per module key.
 *
 *   school off     -> 403 with the one fixed sentence, for ADMIN
 *   platform off   -> 403 (the platform block is a stub until 77.6.01, so it is faked here)
 *   role off       -> 403 for that role only, ADMIN still 200
 *   all others off -> the route still answers 200 (a module never depends on another's switch,
 *                     except the dependants in MODULE_DEPENDENCIES)
 *   everything on  -> 200, and the route/role cells match route-status.snapshot.txt
 *
 * Adding a key to ModuleKey without a row in ROUTES fails to compile, and the drift test below
 * fails if the row's route is not tagged with that key in the snapshot.
 */
const ROUTES: Record<ModuleKey, string> = {
  attendance: '/api/v1/attendance/imports',
  staffAttendance: '/api/v1/leave/policies',
  fees: '/api/v1/fee-structures',
  fines: '/api/v1/fees/fines',
  exams: '/api/v1/exams',
  seatPlans: '/api/v1/seat-plans',
  evaluations: '/api/v1/acr/criteria',
  homework: '/api/v1/homework',
  syllabus: '/api/v1/syllabus-topics',
  studyPlans: '/api/v1/study-plan-templates',
  routines: '/api/v1/routines/shifts',
  programs: '/api/v1/programs',
  admission: '/api/v1/admission-intakes',
  applications: '/api/v1/applications',
  notices: '/api/v1/notices',
  messaging: '/api/v1/communications/logs',
  website: '/api/v1/website',
};
const KEYS = Object.values(ModuleKey);

// ---- the route snapshot, read as data: path -> { module, cell per column } ----
interface SnapRow {
  method: string;
  path: string;
  module: string;
  cells: Record<string, string>;
}
function readSnapshot(): SnapRow[] {
  const lines = readFileSync(join(__dirname, '../../route-status.snapshot.txt'), 'utf8')
    .split('\n')
    .filter(Boolean);
  const columns = lines
    .find((l) => l.startsWith('# columns:'))!
    .replace('# columns:', '')
    .trim()
    .split(/\s+/)
    .filter((c) => c !== 'MODULE');
  return lines
    .filter((l) => !l.startsWith('#'))
    .map((l) => {
      const parts = l.trim().split(/\s+/);
      const cells = Object.fromEntries(columns.map((c, i) => [c, parts[2 + i]]));
      return { method: parts[0], path: parts[1], module: parts[parts.length - 1], cells };
    });
}
const SNAPSHOT = readSnapshot();
const rowFor = (method: string, path: string) =>
  SNAPSHOT.find((r) => r.method === method && r.path === path)!;
/** A non-admin role the snapshot says can reach the route (so a role-off switch is what stops it). */
const otherRoleFor = (path: string): UserRole | undefined =>
  [
    UserRole.ACCOUNTANT,
    UserRole.TEACHER,
    UserRole.OFFICE_STAFF,
    UserRole.EXECUTIVE,
    UserRole.EXAM_CONTROLLER,
    UserRole.COMMITTEE,
    UserRole.PARENT,
    UserRole.STUDENT,
  ].find((r) => rowFor('GET', path).cells[r] === 'PASS');

describe('[77.2.10] every module key: switching it off closes its routes', () => {
  let app: INestApplication;
  let token: string;
  const addedRoles: string[] = [];

  const call = (method: string, path: string, role: UserRole = UserRole.ADMIN) =>
    (supertest(app.getHttpServer()) as any)
      [method.toLowerCase()](path.replace(/:[A-Za-z0-9_]+/g, randomUUID()))
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', role)
      .send(method === 'GET' ? undefined : {});
  const get = (path: string, role?: UserRole) => call('GET', path, role);
  /** ADMIN when the snapshot lets ADMIN in, else the first role it lets in (teacher-only widgets). */
  const roleOf = (row: SnapRow) =>
    row.cells.ADMIN === 'PASS' ? UserRole.ADMIN : (otherRoleFor(row.path) as UserRole);

  /** Every key off except `keep` (and the key it depends on). */
  const allOffExcept = (keep: ModuleKey) =>
    Object.fromEntries(
      KEYS.filter((k) => k !== keep && k !== MODULE_DEPENDENCIES[keep]).map((k) => [
        k,
        { on: false },
      ]),
    );
  const resetAll = () =>
    setModules(app, SEED_TENANT_ID, Object.fromEntries(KEYS.map((k) => [k, null])));

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    // The seeded admin also holds every other role here, so a role-off case has a real member.
    const ds = app.get(DataSource);
    for (const role of Object.values(UserRole)) {
      const inserted = await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING RETURNING role`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, role],
      );
      if (inserted.length) addedRoles.push(role);
    }
    const login = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = login.body.access_token;
  }, 60000);

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetAll();
  });

  afterAll(async () => {
    if (app) {
      if (addedRoles.length) {
        await app
          .get(DataSource)
          .query(
            `DELETE FROM user_tenants WHERE user_id = $1 AND tenant_id = $2 AND role = ANY($3)`,
            [SEED_ADMIN_USER_ID, SEED_TENANT_ID, addedRoles],
          );
      }
      await app.close();
    }
  });

  it('has a row for every ModuleKey, and each row is tagged with that key in the route snapshot', () => {
    expect(Object.keys(ROUTES).sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) {
      const row = rowFor('GET', ROUTES[key]);
      expect(row, `${key}: ${ROUTES[key]} is not in the snapshot`).toBeDefined();
      expect(row.module).toBe(key);
      // D47: "on" means what the snapshot says for ADMIN.
      expect(row.cells.ADMIN).toBe('PASS');
    }
  });

  for (const key of KEYS) {
    describe(key, () => {
      const url = ROUTES[key];

      it('school off -> 403 fixed sentence for ADMIN; on again -> 200', async () => {
        await get(url).expect(200);
        await setModules(app, SEED_TENANT_ID, { [key]: { on: false } });
        const res = await get(url).expect(403);
        expect(res.body.message).toBe(MODULE_OFF_MESSAGE);
        await setModules(app, SEED_TENANT_ID, { [key]: null });
        await get(url).expect(200);
      });

      it('platform off -> 403 fixed sentence', async () => {
        vi.spyOn(app.get(ModuleStateReader) as any, 'platformModules').mockReturnValue({
          [key]: false,
        });
        const res = await get(url).expect(403);
        expect(res.body.message).toBe(MODULE_OFF_MESSAGE);
      });

      // website is ADMIN-only, so there is no other role to switch off for it.
      it.skipIf(!otherRoleFor(url))(
        'role off -> 403 for that role only, ADMIN still 200',
        async () => {
          const role = otherRoleFor(url);
          await setModules(app, SEED_TENANT_ID, { [key]: { offForRoles: [role!] } });
          const res = await get(url, role).expect(403);
          expect(res.body.message).toBe(MODULE_OFF_MESSAGE);
          await get(url).expect(200);
        },
      );

      it('every other module off -> this route still answers 200', async () => {
        await setModules(app, SEED_TENANT_ID, allOffExcept(key));
        await get(url).expect(200);
      });
    });
  }

  it('a dependant follows its base: fees off closes the fines route (dependency)', async () => {
    await setModules(app, SEED_TENANT_ID, { fees: { on: false } });
    const res = await get(ROUTES.fines).expect(403);
    expect(res.body.message).toBe(MODULE_OFF_MESSAGE);
  });

  // ---- mixed controllers: the tag is per handler, not per file ----
  // A refused module is the fixed sentence at 403. Anything else (400 body, 404 id, a different
  // 403 such as the approval token) means the module guard let it through.
  const isModuleOff = (res: { status: number; body: { message?: string } }) =>
    res.status === 403 && res.body.message === MODULE_OFF_MESSAGE;

  describe('POST /fees/bills/:id/waive sits in the fines controller but is tagged fees', () => {
    const waive = '/api/v1/fees/bills/:id/waive';
    it('fines off -> still reaches the handler (a bill waive is not a fine)', async () => {
      await setModules(app, SEED_TENANT_ID, { fines: { on: false } });
      expect(isModuleOff(await call('POST', waive))).toBe(false);
    });
    it('fees off -> refused with the fixed sentence', async () => {
      await setModules(app, SEED_TENANT_ID, { fees: { on: false } });
      expect(isModuleOff(await call('POST', waive))).toBe(true);
    });
  });

  describe('fee reminders sit in the communications controller but are tagged fees (D39)', () => {
    const reminders = SNAPSHOT.filter(
      (r) =>
        r.path.startsWith('/api/v1/communications/reminder/') ||
        r.path === '/api/v1/communications/reminder/bulk' ||
        r.path === '/api/v1/communications/last-reminders',
    );
    it('covers the 7 reminder handlers + last-reminders (8 rows)', () => {
      expect(reminders).toHaveLength(8);
      expect(new Set(reminders.map((r) => r.module))).toEqual(new Set(['fees']));
    });
    it('messaging off -> none of them is refused (automatic fee messages are fees, not messaging)', async () => {
      await setModules(app, SEED_TENANT_ID, { messaging: { on: false } });
      for (const r of reminders) {
        expect(isModuleOff(await call(r.method, r.path)), `${r.method} ${r.path}`).toBe(false);
      }
    });
    it('fees off -> every one is refused', async () => {
      await setModules(app, SEED_TENANT_ID, { fees: { on: false } });
      for (const r of reminders) {
        expect(isModuleOff(await call(r.method, r.path)), `${r.method} ${r.path}`).toBe(true);
      }
    });
    it('the message-history route is messaging: off with messaging, open with fees off', async () => {
      await setModules(app, SEED_TENANT_ID, { fees: { on: false } });
      await get('/api/v1/communications/logs').expect(200);
      await setModules(app, SEED_TENANT_ID, { fees: null, messaging: { on: false } });
      expect(isModuleOff(await get('/api/v1/communications/logs'))).toBe(true);
    });
  });

  describe('dashboard widgets follow their own module', () => {
    // Decision (77.2.10): SYLLABUS_VS_PLAN stays on `syllabus`. It is a syllabus card (done % per
    // class) that only adds the plan's expected line when a plan exists, so a school that turned
    // study plans off still wants it. Pinned here so a retag is a visible change.
    const widgets = SNAPSHOT.filter(
      (r) => r.path.startsWith('/api/v1/dashboard/widgets/') && r.module !== '-',
    );
    it('has widgets for homework, syllabus and study plans', () => {
      const modules = widgets.map((w) => w.module);
      for (const m of ['homework', 'syllabus', 'studyPlans']) expect(modules).toContain(m);
      expect(rowFor('GET', '/api/v1/dashboard/widgets/syllabus-vs-plan').module).toBe('syllabus');
    });
    for (const w of widgets) {
      it(`${w.path.split('/').pop()} (${w.module}): its module off closes it, the others off do not`, async () => {
        const key = w.module as ModuleKey;
        await setModules(app, SEED_TENANT_ID, allOffExcept(key));
        expect(isModuleOff(await get(w.path, roleOf(w))), 'others off').toBe(false);
        await setModules(app, SEED_TENANT_ID, { ...allOffExcept(key), [key]: { on: false } });
        expect(isModuleOff(await get(w.path, roleOf(w))), 'own off').toBe(true);
      });
    }
  });
});
