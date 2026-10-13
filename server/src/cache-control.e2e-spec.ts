import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  Controller,
  Get,
  Header,
  INestApplication,
  NotFoundException,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import express from 'express';
import supertest = require('supertest');
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { configureApiVersioning } from '../test/helpers/e2e-app.helper';

import { apiNoStoreByDefault, setStaticCacheHeaders } from './cache-control';
import { buildSpaFallback } from './spa-fallback';

/** Test-only routes standing in for the real ones, so no database is needed. */
@Controller('probe')
class ProbeController {
  @Get('json')
  json() {
    return { ok: true };
  }

  @Get('calendar')
  @Header('Cache-Control', 'private, max-age=900')
  @Header('Content-Type', 'text/calendar')
  calendar() {
    return 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';
  }

  @Get('asset')
  @Header('Cache-Control', 'private, max-age=31536000, immutable')
  @Header('Content-Type', 'image/png')
  asset() {
    return new StreamableFile(Buffer.from('png'));
  }

  @Get('csv')
  csv(@Res({ passthrough: true }) res: express.Response) {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="x.csv"');
    return 'a,b\n1,2\n';
  }

  @Get('missing')
  missing() {
    throw new NotFoundException();
  }
}

describe('Cache-Control defaults E2E', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
    app = moduleRef.createNestApplication();
    configureApiVersioning(app);
    app.use('/api', apiNoStoreByDefault);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string) => supertest(app.getHttpServer()).get(`/api/v1/probe/${path}`);

  it('JSON gets no-store', async () => {
    const res = await get('json').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('a download gets no-store and keeps Content-Disposition', async () => {
    const res = await get('csv').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-disposition']).toBe('attachment; filename="x.csv"');
  });

  it('an error response gets no-store', async () => {
    const res = await get('missing').expect(404);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('the calendar feed keeps its own header', async () => {
    const res = await get('calendar').expect(200);
    expect(res.headers['cache-control']).toBe('private, max-age=900');
  });

  it('an immutable asset route stays immutable', async () => {
    const res = await get('asset').expect(200);
    expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
  });
});

describe('SPA shell Cache-Control E2E', () => {
  let dir: string;
  let server: express.Express;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'spa-cache-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    writeFileSync(join(dir, 'sw.js'), '//sw');
    writeFileSync(join(dir, 'assets', 'app-x.js'), '//app');
    server = express();
    server.use(express.static(dir, { setHeaders: setStaticCacheHeaders }));
    server.use(buildSpaFallback(dir));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it.each(['/', '/students/42', '/sw.js'])('%s is no-cache', async (path) => {
    const res = await supertest(server).get(path).expect(200);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('a hashed asset is not no-cache', async () => {
    const res = await supertest(server).get('/assets/app-x.js').expect(200);
    expect(res.headers['cache-control']).not.toContain('no-cache');
  });

  it('a missing asset is a 404', async () => {
    await supertest(server).get('/assets/missing.js').expect(404);
  });
});
