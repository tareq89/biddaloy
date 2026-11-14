import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ModuleKey, UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { MODULE_OFF_MESSAGE } from '../../common/filters/known-errors';
import { setModules } from '@test/helpers/modules.helper';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';
import { NoticeLinksService } from './links/notice-links.service';
import { NOTICE_LINK_NOT_FOUND } from './links/public-notice.controller';

const ROOT = 'modoff.e2e.test';

/**
 * [77.2.06] One case per module key this ticket tags (notices, website), plus the public routes
 * that cannot be tagged: the notice link (dead-link 404) and the school site (site 404, notices
 * section hidden). The full table-driven spec is the wave-2 close (77.2.10).
 */
describe('[77.2.06] notices and website controllers honour the module switch', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  const api = () => supertest(app.getHttpServer());
  const admin = (url: string) =>
    api()
      .get(url)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.ADMIN);

  beforeAll(async () => {
    process.env.SITE_ROOT_DOMAIN = ROOT;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = res.body.access_token;
  }, 60000);

  afterAll(async () => {
    await setModules(app, SEED_TENANT_ID, { notices: null, website: null });
    await app.close();
  });

  it('notices: off -> 403 fixed text for ADMIN, on -> 200', async () => {
    await setModules(app, SEED_TENANT_ID, { [ModuleKey.notices]: { on: false } });
    const off = await admin('/api/v1/notices').expect(403);
    expect(off.body.message).toBe(MODULE_OFF_MESSAGE);

    await setModules(app, SEED_TENANT_ID, { [ModuleKey.notices]: null });
    await admin('/api/v1/notices').expect(200);
  });

  it('website: off -> 403 fixed text for ADMIN, on -> 200', async () => {
    await setModules(app, SEED_TENANT_ID, { [ModuleKey.website]: { on: false } });
    const off = await admin('/api/v1/website').expect(403);
    expect(off.body.message).toBe(MODULE_OFF_MESSAGE);

    await setModules(app, SEED_TENANT_ID, { [ModuleKey.website]: null });
    await admin('/api/v1/website').expect(200);
  });

  it('public notice link: notices off -> the one dead-link 404, on -> 200', async () => {
    const [n] = await ds.query(
      `INSERT INTO notices (tenant_id, author_user_id, title, body, status, published_at, is_public)
       VALUES ($1,$2,'Exam notice','Body text','PUBLISHED',NOW(),true) RETURNING id, tenant_id`,
      [SEED_TENANT_ID, SEED_ADMIN_USER_ID],
    );
    const link = await app.get(NoticeLinksService).createPublicLink(n);
    const url = `/api/v1/public/notices/${link}`;

    await setModules(app, SEED_TENANT_ID, { notices: { on: false } });
    const off = await api().get(url).expect(404);
    expect(off.body.message).toBe(NOTICE_LINK_NOT_FOUND);

    await setModules(app, SEED_TENANT_ID, { notices: null });
    await api().get(url).expect(200);
  });

  it('public site: website off -> site 404; notices off -> notices island 404 and section hidden', async () => {
    const site = (await admin('/api/v1/website').expect(200)).body;
    await ds.query(
      `UPDATE school_sites SET published = draft, enabled = true WHERE tenant_id = $1`,
      [SEED_TENANT_ID],
    );
    const base = `/api/v1/public/site/by-host/${site.subdomain}.${ROOT}`;
    await api().get(`${base}/manifest`).expect(200);

    await setModules(app, SEED_TENANT_ID, { website: { on: false } });
    const gone = await api().get(`${base}/manifest`).expect(404);
    expect(gone.body.message).toBe('site.not_found');

    await setModules(app, SEED_TENANT_ID, { website: null, notices: { on: false } });
    await api().get(`${base}/island/notices`).expect(404);
    const home = await api().get(`${base}/page/home`).expect(200);
    for (const s of home.body.sections.filter((x: { key: string }) => x.key === 'notices')) {
      expect(s.empty).toBe(true);
      expect(s.feed).toEqual([]);
    }

    await setModules(app, SEED_TENANT_ID, { notices: null });
    await api().get(`${base}/island/notices`).expect(200);
  });
});
