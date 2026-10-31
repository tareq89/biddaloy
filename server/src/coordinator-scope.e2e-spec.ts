import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from './app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from './validation-pipe';
import { SEED_TENANT_ID } from '@test/constants';
import {
  createTeacherScopeFixture,
  TeacherScopeFixture,
} from '@test/helpers/teacher-scope.fixture';
import {
  COORDINATOR_READ_ROUTES,
  COORDINATOR_UNCHANGED_ROUTES,
} from '@test/helpers/coordinator-scope-routes';

/**
 * Epic 83 (83.0.2 baseline, 83.3.1 widening). The fixture teacher teaches section A only;
 * section B is another class of the current year.
 *
 * - Baseline (no coordinator row): every listed route answers for B exactly as on main — 404.
 * - With a class-coordinator row on B's class: the read routes answer 200 for B (D4); the
 *   unchanged routes (writes, fees, notes) still answer 404 for B (D4, D5).
 * - Section A answers 200 throughout, so the teaching scope never shrinks.
 */
const API = '/api/v1';

describe('Coordinator scope (83.0.2 / 83.3.1)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fx: TeacherScopeFixture;
  let token: string;

  const call = (
    method: 'get' | 'put' | 'post',
    path: string,
    tenantId: string | null = SEED_TENANT_ID,
  ) => {
    const r = supertest(app.getHttpServer())
      [method](`${API}${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Role', UserRole.TEACHER);
    return tenantId === null ? r : r.set('X-Tenant-ID', tenantId);
  };
  const idsB = () => ({ s: fx.studentB, g: fx.guardianB, sec: fx.sectionB });
  const idsA = () => ({ s: fx.studentA, g: fx.guardianA, sec: fx.sectionA });
  const registerBody = {
    date: '2026-10-20',
    base_version: 0,
    client_request_id: randomUUID(),
    entries: [],
  };

  /** Makes the fixture teacher class coordinator of section B's class. */
  async function coordinateB() {
    const [{ id: teacherId }] = await dataSource.query(
      `SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2`,
      [fx.teacherUserId, SEED_TENANT_ID],
    );
    await dataSource.query(
      `INSERT INTO coordinator_assignments (tenant_id, teacher_id, class_id)
       SELECT $1, $2, class_id FROM class_sections WHERE id = $3`,
      [SEED_TENANT_ID, teacherId, fx.sectionB],
    );
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
    fx = await createTeacherScopeFixture(app, dataSource);
    token = await fx.login();
  }, 120000);

  afterAll(async () => {
    await fx?.cleanup();
    await app?.close();
  });

  beforeEach(async () => {
    await fx.seed();
  });

  const send = (route: (typeof COORDINATOR_READ_ROUTES)[number], ids: ReturnType<typeof idsB>) => {
    const r = call(route.method, route.path(ids));
    return route.method === 'get'
      ? r
      : r.send({ ...registerBody, client_request_id: randomUUID() });
  };

  describe('baseline: a TEACHER with no coordinator rows (as on main)', () => {
    for (const route of [...COORDINATOR_READ_ROUTES, ...COORDINATOR_UNCHANGED_ROUTES]) {
      it(`${route.name} for section B is 404 (${route.gate})`, async () => {
        await send(route, idsB()).expect(404);
      });
    }

    it('GET /students lists section A only; search does not find B', async () => {
      const res = await call('get', '/students?limit=100').expect(200);
      const ids = res.body.data.map((s: { id: string }) => s.id);
      expect(ids).toContain(fx.studentA);
      expect(ids).not.toContain(fx.studentB);
      const search = await call('get', '/search?q=TS%20Student').expect(200);
      expect(JSON.stringify(search.body)).not.toContain(fx.studentB);
    });
  });

  describe('with a class-coordinator row on B’s class', () => {
    for (const route of COORDINATOR_READ_ROUTES) {
      it(`${route.name} for section B is 200 (${route.gate})`, async () => {
        await coordinateB();
        await send(route, idsB()).expect(200);
      });
    }

    for (const route of COORDINATOR_UNCHANGED_ROUTES) {
      it(`${route.name} for section B is still 404 (${route.gate})`, async () => {
        await coordinateB();
        await send(route, idsB()).expect(404);
      });
    }

    it('GET /students now lists A and B; search finds B', async () => {
      await coordinateB();
      const res = await call('get', '/students?limit=100').expect(200);
      const ids = res.body.data.map((s: { id: string }) => s.id);
      expect(ids).toEqual(expect.arrayContaining([fx.studentA, fx.studentB]));
      // The past-year section C stays out: coordinator rows are current-year only (D14).
      expect(ids).not.toContain(fx.studentC);
      const search = await call('get', '/search?q=TS%20Student').expect(200);
      expect(JSON.stringify(search.body)).toContain(fx.studentB);
    });

    it('section A still answers 200 (the teaching scope never shrinks)', async () => {
      await coordinateB();
      await call('get', COORDINATOR_READ_ROUTES[0].path(idsA())).expect(200);
    });
  });

  describe('X-Tenant-ID on a widened route', () => {
    it('missing is 401; a garbage id is refused', async () => {
      await call('get', `/students/${fx.studentA}`, null).expect(401);
      const bad = await call('get', `/students/${fx.studentA}`, 'not-a-tenant');
      expect([400, 401, 403]).toContain(bad.status);
    });
  });
});
