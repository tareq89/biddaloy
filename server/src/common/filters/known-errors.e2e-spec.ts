import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { configureBodyParser } from '../../body-parser';
import { AllExceptionsFilter } from './http-exception.filter';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/**
 * [2634] Errors raised before a controller runs (body-parser) and library
 * errors (Postgres unique violation, multer) answer a fixed 4xx, never a 500,
 * and never echo what was sent. #2612 and #2616 append their cases here.
 */
const API = '/api/v1';

describe('known-errors (e2e)', () => {
  let app: NestExpressApplication;
  let adminToken: string;
  const login = () =>
    supertest(app.getHttpServer()).post(`${API}/auth/login`).set('X-Tenant-ID', SEED_TENANT_ID);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApiVersioning(app);
    configureBodyParser(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const loginRes = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('body-parser errors', () => {
    it('answers 413 for a body over the JSON limit', async () => {
      const big = JSON.stringify({ email: 'a'.repeat(1_500_000) });
      const res = await login().set('Content-Type', 'application/json').send(big);
      expect(res.status).toBe(413);
      expect(res.body.message).toBe('Request body too large');
    });

    it('answers 415 for an unsupported charset and does not echo it', async () => {
      const res = await login()
        .set('Content-Type', 'application/json; charset=bogus')
        .send('{"a":1}');
      expect(res.status).toBe(415);
      expect(JSON.stringify(res.body)).not.toMatch(/bogus/i);
    });

    it('answers 400 for a content-encoding gzip body that is not gzip', async () => {
      const res = await login()
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'gzip')
        .send('plain text, not gzip');
      expect(res.status).toBe(400);
    });

    it('answers 400 for malformed JSON', async () => {
      const res = await login().set('Content-Type', 'application/json').send('{"a":');
      expect(res.status).toBe(400);
    });
  });
  describe('duplicate names (unique violation)', () => {
    const api = (method: 'post' | 'patch', url: string) =>
      supertest(app.getHttpServer())
        [method](`${API}${url}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID);
    // D18: a unique suffix per run so reruns never collide.
    const suffix = () => randomUUID().slice(0, 8);

    const createClass = async (name: string) =>
      api('post', '/classes').send({ name, academic_year_id: SEED_ACADEMIC_YEAR_ID });

    it('class: creating the same name twice gives 409 without echoing the name', async () => {
      const name = `Dup Class ${suffix()}`;
      await createClass(name).then((r) => expect(r.status).toBe(201));
      const res = await createClass(name);
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('A class with this name already exists in this year');
      expect(JSON.stringify(res.body)).not.toContain(name);
    });

    it('class: renaming onto an existing name gives 409', async () => {
      const a = `Ren A ${suffix()}`;
      const first = await createClass(a);
      const second = await createClass(`Ren B ${suffix()}`);
      expect(first.status).toBe(201);
      const res = await api('patch', `/classes/${second.body.id}`).send({ name: a });
      expect(res.status).toBe(409);
      expect(JSON.stringify(res.body)).not.toContain(a);
    });

    it('section: create twice and rename onto an existing name give 409', async () => {
      const cls = await createClass(`Sec Class ${suffix()}`);
      const sectionsUrl = `/classes/${cls.body.id}/sections`;
      const name = `S${suffix()}`;
      await api('post', sectionsUrl)
        .send({ section_name: name, capacity: 30 })
        .then((r) => expect(r.status).toBe(201));
      const dup = await api('post', sectionsUrl).send({ section_name: name, capacity: 30 });
      expect(dup.status).toBe(409);
      expect(dup.body.message).toBe('A section with this name already exists in this class');
      expect(JSON.stringify(dup.body)).not.toContain(name);

      const other = await api('post', sectionsUrl).send({
        section_name: `T${suffix()}`,
        capacity: 30,
      });
      const ren = await api('patch', `${sectionsUrl}/${other.body.id}`).send({
        section_name: name,
      });
      expect(ren.status).toBe(409);
    });

    it('academic year: create twice and rename onto an existing name give 409', async () => {
      // Far-future, non-overlapping ranges so only the name can collide.
      const base = 4000 + Math.floor(Math.random() * 4000);
      const year = (offset: number, name: string) =>
        api('post', '/academic-years').send({
          name,
          start_date: `${base + offset}-01-01`,
          end_date: `${base + offset}-12-31`,
        });
      const name = `Dup Year ${suffix()}`;
      await year(0, name).then((r) => expect(r.status).toBe(201));
      const dup = await year(1, name);
      expect(dup.status).toBe(409);
      expect(dup.body.message).toBe('An academic year with this name already exists');
      expect(JSON.stringify(dup.body)).not.toContain(name);

      const other = await year(2, `Other Year ${suffix()}`);
      const ren = await api('patch', `/academic-years/${other.body.id}`).send({ name });
      expect(ren.status).toBe(409);
    });

    // [2657] Names that differ only by letter case are the same name in one school.
    it('class: a case-only duplicate gives 409 on create and on rename, without echoing', async () => {
      const name = `Case Clash ${suffix()}`;
      await createClass(name).then((r) => expect(r.status).toBe(201));
      const res = await createClass(name.toLowerCase());
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('A class with this name already exists in this year');
      expect(JSON.stringify(res.body)).not.toContain(name.toLowerCase());

      const other = await createClass(`Case Other ${suffix()}`);
      const ren = await api('patch', `/classes/${other.body.id}`).send({
        name: name.toUpperCase(),
      });
      expect(ren.status).toBe(409);
    });

    it('section: a case-only duplicate gives 409 on create and on rename', async () => {
      const cls = await createClass(`Case Sec Class ${suffix()}`);
      const sectionsUrl = `/classes/${cls.body.id}/sections`;
      const name = `Blue${suffix()}`;
      await api('post', sectionsUrl)
        .send({ section_name: name, capacity: 30 })
        .then((r) => expect(r.status).toBe(201));
      const dup = await api('post', sectionsUrl).send({
        section_name: name.toUpperCase(),
        capacity: 30,
      });
      expect(dup.status).toBe(409);
      expect(dup.body.message).toBe('A section with this name already exists in this class');
      expect(JSON.stringify(dup.body)).not.toContain(name.toUpperCase());

      const other = await api('post', sectionsUrl).send({
        section_name: `T${suffix()}`,
        capacity: 30,
      });
      const ren = await api('patch', `${sectionsUrl}/${other.body.id}`).send({
        section_name: name.toLowerCase(),
      });
      expect(ren.status).toBe(409);
    });

    it('academic year: a case-only duplicate gives 409 on create and on rename', async () => {
      const base = 4000 + Math.floor(Math.random() * 4000);
      const year = (offset: number, name: string) =>
        api('post', '/academic-years').send({
          name,
          start_date: `${base + offset}-01-01`,
          end_date: `${base + offset}-12-31`,
        });
      const name = `Case Year ${suffix()}`;
      await year(0, name).then((r) => expect(r.status).toBe(201));
      const dup = await year(1, name.toUpperCase());
      expect(dup.status).toBe(409);
      expect(dup.body.message).toBe('An academic year with this name already exists');
      expect(JSON.stringify(dup.body)).not.toContain(name.toUpperCase());

      const other = await year(2, `Case Other ${suffix()}`);
      const ren = await api('patch', `/academic-years/${other.body.id}`).send({
        name: name.toLowerCase(),
      });
      expect(ren.status).toBe(409);
    });
  });

  describe('multer errors', () => {
    const upload = (field: string) =>
      supertest(app.getHttpServer())
        .post(`${API}/students/bulk-upload/validate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .attach(field, Buffer.from('x'), 'a.xlsx');

    it('answers 400 for a wrong field name and does not echo it', async () => {
      const res = await upload('wrong_field');
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Unexpected upload field');
      expect(JSON.stringify(res.body)).not.toContain('wrong_field');
    });

    it('leaves the correct field alone: the route reports its own error', async () => {
      const res = await upload('file');
      expect(res.status).toBe(400);
      expect(res.body.message).not.toBe('Unexpected upload field');
    });
  });
});
