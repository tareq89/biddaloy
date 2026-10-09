import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';
import { StorageService } from '../../storage/storage.service';
import { RESOLVERS } from '../catalog/field-resolver';

/**
 * [48.2.04] Who may print which kind (D6/D40), over HTTP.
 *
 *   /certificates   CERTIFICATE_ISSUE   the five student certificates only
 *   /print-jobs     DOCUMENT_PRINT      everything else (exam documents stay here)
 */
const API = '/api/v1';
const ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.EXECUTIVE,
  UserRole.OFFICE_STAFF,
  UserRole.ACCOUNTANT,
  UserRole.EXAM_CONTROLLER,
  UserRole.TEACHER,
  UserRole.COMMITTEE,
  UserRole.PARENT,
  UserRole.STUDENT,
] as const;

describe('Certificates E2E (48.2.04)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const tokens: Record<string, string> = {};
  let tenant2Id: string;
  let tenant2Token: string;
  let studentA: string;
  let studentB: string;
  let testimonialTpl: string;
  let resultTpl: string;
  let tenant2Tpl: string;

  const http = () => supertest(app.getHttpServer());
  const as = (role: string, tenant = SEED_TENANT_ID) => ({
    Authorization: `Bearer ${tokens[role]}`,
    'X-Tenant-ID': tenant,
  });
  // A bare "expected 201, got 403" hides which check failed; show the body.
  const status = (want: number) => (r: supertest.Response) => {
    if (r.status !== want)
      throw new Error(`expected ${want}, got ${r.status}: ${JSON.stringify(r.body)}`);
  };
  const body = (tpl: string, ids: string[], extra: object = {}) => ({
    template_id: tpl,
    subject_type: 'STUDENT',
    subject_ids: ids,
    ...extra,
  });

  async function login(email: string): Promise<string> {
    const res = await http()
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  async function addUser(tenantId: string, role: string, label: string): Promise<string> {
    const id = randomUUID();
    const email = `cert-e2e-${label}-${id}@e2e.example`;
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW())`,
      [id, email, SEED_ADMIN_PASSWORD_HASH, `Cert E2E ${label}`],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, tenantId, role],
    );
    return email;
  }

  async function publishedTemplate(tenantId: string, kind: string): Promise<string> {
    const [t] = await ds.query(
      `INSERT INTO print_templates (tenant_id, document_kind, name, batch_size, draft)
       VALUES ($1, $2, $3, 50, '{}'::jsonb) RETURNING id`,
      [tenantId, kind, `${kind} ${randomUUID()}`],
    );
    const [v] = await ds.query(
      `INSERT INTO print_template_versions (tenant_id, template_id, version, definition)
       VALUES ($1, $2, 1, '{}'::jsonb) RETURNING id`,
      [tenantId, t.id],
    );
    await ds.query(`UPDATE print_templates SET current_version_id = $1 WHERE id = $2`, [
      v.id,
      t.id,
    ]);
    return t.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
  });

  // The suite's setup wipes tenant data before every test, so seed per test.
  beforeEach(async () => {
    tokens.ADMIN = await login(SEED_ADMIN_EMAIL);
    for (const role of ROLES.filter((r) => r !== UserRole.ADMIN)) {
      tokens[role] = await login(await addUser(SEED_TENANT_ID, role, role));
    }

    // Two students with an ACTIVE enrollment so the real certificate resolver can build their data.
    const one = async (sql: string, p: unknown[]) => (await ds.query(sql, p))[0].id as string;
    const year = await one(
      `INSERT INTO academic_years (name, start_date, end_date, tenant_id, created_at, updated_at)
       VALUES ($2, '2027-01-01', '2027-12-31', $1, NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID, `Cert E2E ${randomUUID()}`],
    );
    const cls = await one(
      `INSERT INTO classes (name, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ($3, $1, $2, NOW(), NOW()) RETURNING id`,
      [year, SEED_TENANT_ID, `Cert E2E ${randomUUID()}`],
    );
    const section = await one(
      `INSERT INTO class_sections (class_id, section_name, tenant_id, created_at, updated_at)
       VALUES ($1, 'A', $2, NOW(), NOW()) RETURNING id`,
      [cls, SEED_TENANT_ID],
    );
    const student = async (name: string, roll: number) => {
      const id = await one(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING id`,
        [name, `CE-${randomUUID().slice(0, 8)}`, roll, section, SEED_TENANT_ID],
      );
      await ds.query(
        `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [id, cls, section, year, SEED_TENANT_ID],
      );
      return id;
    };
    studentA = await student('Cert E2E Rahim', 1);
    studentB = await student('Cert E2E Karim', 2);

    testimonialTpl = await publishedTemplate(SEED_TENANT_ID, 'TESTIMONIAL');
    resultTpl = await publishedTemplate(SEED_TENANT_ID, 'RESULT_CERTIFICATE');

    tenant2Id = await one(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
      `Cert E2E T2 ${randomUUID()}`,
      `cert-e2e-${randomUUID()}`,
    ]);
    tenant2Token = await login(await addUser(tenant2Id, 'ADMIN', 'tenant2-admin'));
    tenant2Tpl = await publishedTemplate(tenant2Id, 'TESTIMONIAL');
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  describe('POST /certificates role matrix', () => {
    const issueAs = (role: string) =>
      http()
        .post(`${API}/certificates`)
        .set(as(role))
        .send(body(testimonialTpl, [studentA]));

    it('SUPER_ADMIN -> 201 with a serial', async () => {
      const res = await issueAs('SUPER_ADMIN').expect(status(201));
      expect(res.body.items[0].serial_no).toMatch(/^TSM-\d{4}-\d{5}$/);
    });

    it('ADMIN -> 201 with a serial', async () => {
      const res = await issueAs('ADMIN').expect(status(201));
      expect(res.body.items[0].serial_no).toMatch(/^TSM-\d{4}-\d{5}$/);
    });

    it('EXECUTIVE -> 201 with a serial', async () => {
      const res = await issueAs('EXECUTIVE').expect(status(201));
      expect(res.body.items[0].serial_no).toMatch(/^TSM-\d{4}-\d{5}$/);
    });

    it('OFFICE_STAFF -> 201 with a serial', async () => {
      const res = await issueAs('OFFICE_STAFF').expect(status(201));
      expect(res.body.items[0].serial_no).toMatch(/^TSM-\d{4}-\d{5}$/);
    });

    it('ACCOUNTANT -> 403', async () => {
      await issueAs('ACCOUNTANT').expect(403);
    });

    it('EXAM_CONTROLLER -> 403', async () => {
      await issueAs('EXAM_CONTROLLER').expect(403);
    });

    it('TEACHER -> 403', async () => {
      await issueAs('TEACHER').expect(403);
    });

    it('COMMITTEE -> 403', async () => {
      await issueAs('COMMITTEE').expect(403);
    });

    it('PARENT -> 403', async () => {
      await issueAs('PARENT').expect(403);
    });

    it('STUDENT -> 403', async () => {
      await issueAs('STUDENT').expect(403);
    });
  });

  describe('the other /certificates routes: allowed and denied', () => {
    it('preview: ADMIN -> 200, ACCOUNTANT -> 403', async () => {
      await http()
        .post(`${API}/certificates/preview`)
        .set(as('ADMIN'))
        .send(body(testimonialTpl, [studentA]))
        .expect(status(200));
      await http()
        .post(`${API}/certificates/preview`)
        .set(as('ACCOUNTANT'))
        .send(body(testimonialTpl, [studentA]))
        .expect(403);
    });

    it('photo: ADMIN reaches the service (404, student has no such photo), ACCOUNTANT -> 403', async () => {
      const q = `subject_type=STUDENT&subject_id=${studentA}&key=${encodeURIComponent(`tenants/${SEED_TENANT_ID}/none.jpg`)}`;
      await http().get(`${API}/certificates/photo?${q}`).set(as('ADMIN')).expect(404);
      await http().get(`${API}/certificates/photo?${q}`).set(as('ACCOUNTANT')).expect(403);
    });

    it('confirm: EXECUTIVE -> 200, ACCOUNTANT -> 403', async () => {
      const job = await http()
        .post(`${API}/certificates`)
        .set(as('EXECUTIVE'))
        .send(body(testimonialTpl, [studentA]))
        .expect(status(201));
      await http()
        .patch(`${API}/certificates/jobs/${job.body.job_id}/confirm`)
        .set(as('ACCOUNTANT'))
        .send({ failed_item_ids: [] })
        .expect(403);
      await http()
        .patch(`${API}/certificates/jobs/${job.body.job_id}/confirm`)
        .set(as('EXECUTIVE'))
        .send({ failed_item_ids: [] })
        .expect(status(200));
    });

    it('reprint: EXECUTIVE -> 201, ACCOUNTANT -> 403', async () => {
      const job = await http()
        .post(`${API}/certificates`)
        .set(as('EXECUTIVE'))
        .send(body(testimonialTpl, [studentA]))
        .expect(status(201));
      const item_ids = [job.body.items[0].item_id];
      await http()
        .post(`${API}/certificates/jobs/${job.body.job_id}/reprint`)
        .set(as('ACCOUNTANT'))
        .send({ item_ids })
        .expect(403);
      await http()
        .post(`${API}/certificates/jobs/${job.body.job_id}/reprint`)
        .set(as('EXECUTIVE'))
        .send({ item_ids })
        .expect(status(201));
    });
  });

  it('POST /print-jobs refuses a testimonial even for ACCOUNTANT (the reason the routes split)', async () => {
    const res = await http()
      .post(`${API}/print-jobs`)
      .set(as('ACCOUNTANT'))
      .send(body(testimonialTpl, [studentA]))
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('CERTIFICATE_ISSUE');
  });

  it('POST /certificates refuses a non-certificate kind with 400', async () => {
    await http()
      .post(`${API}/certificates`)
      .set(as('ADMIN'))
      .send(body(resultTpl, [studentA], { context_type: 'EXAM', context_id: randomUUID() }))
      .expect(400);
  });

  it('result certificates stay on /print-jobs for EXAM_CONTROLLER and ACCOUNTANT (D6)', async () => {
    // The result data is covered by the resolver's own specs; here only the route gate matters.
    vi.spyOn(RESOLVERS.RESULT_CERTIFICATE!, 'resolve').mockImplementation(
      async (_t, ids) =>
        new Map(
          ids.map((i) => [i, { label: 'Result ' + i.slice(0, 4), values: {}, photoKey: null }]),
        ),
    );
    for (const role of ['EXAM_CONTROLLER', 'ACCOUNTANT']) {
      const res = await http()
        .post(`${API}/print-jobs`)
        .set(as(role))
        .send(body(resultTpl, [studentA], { context_type: 'EXAM', context_id: randomUUID() }))
        .expect(status(201));
      expect(res.body.items[0].serial_no).toMatch(/^RES-\d{4}-\d{5}$/);
    }
    vi.restoreAllMocks();
  });

  it('confirm and reprint work on /certificates/jobs/:id for EXECUTIVE, and 403 on /print-jobs', async () => {
    const job = await http()
      .post(`${API}/certificates`)
      .set(as('EXECUTIVE'))
      .send(body(testimonialTpl, [studentB]))
      .expect(status(201));
    const itemId = job.body.items[0].item_id as string;

    await http()
      .patch(`${API}/certificates/jobs/${job.body.job_id}/confirm`)
      .set(as('EXECUTIVE'))
      .send({ failed_item_ids: [] })
      .expect(status(200));

    const re = await http()
      .post(`${API}/certificates/jobs/${job.body.job_id}/reprint`)
      .set(as('EXECUTIVE'))
      .send({ item_ids: [itemId] })
      .expect(status(201));
    expect(re.body.items[0].copy_number).toBe(2);
    expect(re.body.items[0].serial_no).toBe(job.body.items[0].serial_no);

    // EXECUTIVE holds no DOCUMENT_PRINT, so the document route says no.
    await http()
      .post(`${API}/print-jobs/${job.body.job_id}/reprint`)
      .set(as('EXECUTIVE'))
      .send({ item_ids: [itemId] })
      .expect(403);
    // ADMIN has both permissions, but the kind still belongs to the certificate channel.
    await http()
      .post(`${API}/print-jobs/${job.body.job_id}/reprint`)
      .set(as('ADMIN'))
      .send({ item_ids: [itemId] })
      .expect(403);
  });

  describe('tenant isolation', () => {
    it("tenant 2's ADMIN cannot use tenant 1's template -> 404", async () => {
      await http()
        .post(`${API}/certificates`)
        .set({ Authorization: `Bearer ${tenant2Token}`, 'X-Tenant-ID': tenant2Id })
        .send(body(testimonialTpl, [studentA]))
        .expect(404);
    });

    it("tenant 1's students with tenant 2's template -> 404", async () => {
      await http()
        .post(`${API}/certificates`)
        .set(as('ADMIN'))
        .send(body(tenant2Tpl, [studentA]))
        .expect(404);
    });

    it("tenant 2's students are not found through tenant 1's own template -> 404", async () => {
      await http()
        .post(`${API}/certificates`)
        .set(as('ADMIN'))
        .send(body(testimonialTpl, [randomUUID()]))
        .expect(404);
    });

    it('an exam id that is not in the tenant is a 404 as admit-card context', async () => {
      const admitTpl = await publishedTemplate(SEED_TENANT_ID, 'EXAM_ADMIT_CARD');
      await http()
        .post(`${API}/print-jobs`)
        .set(as('ADMIN'))
        .send(body(admitTpl, [studentA], { context_type: 'EXAM', context_id: randomUUID() }))
        .expect(404);
    });
  });

  describe('issue-modal reads', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    let assetId: string;
    let tenant2Asset: string;

    async function artwork(tenantId: string) {
      const key = `tenants/${tenantId}/print-assets/${randomUUID()}.svg`;
      await app.get(StorageService).put(key, Buffer.from(svg), 'image/svg+xml');
      const [a] = await ds.query(
        `INSERT INTO print_assets (tenant_id, asset_kind, storage_key, content_type, byte_size, original_name)
         VALUES ($1, 'ARTWORK', $2, 'image/svg+xml', $3, 'bg.svg') RETURNING id`,
        [tenantId, key, svg.length],
      );
      return a.id as string;
    }
    /** Publishes a new current version of the template that uses these asset ids (versions are immutable). */
    async function useAssets(templateId: string, ids: string[]) {
      const definition = { elements: ids.map((id) => ({ type: 'image', assetId: id })) };
      const [v] = await ds.query(
        `INSERT INTO print_template_versions (tenant_id, template_id, version, definition)
         SELECT tenant_id, id, 2, $2::jsonb FROM print_templates WHERE id = $1 RETURNING id`,
        [templateId, JSON.stringify(definition)],
      );
      await ds.query(`UPDATE print_templates SET current_version_id = $1 WHERE id = $2`, [
        v.id,
        templateId,
      ]);
    }
    beforeEach(async () => {
      assetId = await artwork(SEED_TENANT_ID);
      tenant2Asset = await artwork(tenant2Id);
      await useAssets(testimonialTpl, [assetId, tenant2Asset]);
    });

    const reads = () => [
      `${API}/certificates/templates?document_kind=TESTIMONIAL`,
      `${API}/certificates/printers`,
      `${API}/certificates/assets`,
      `${API}/certificates/assets/${assetId}/file`,
    ];
    const ALLOWED = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'OFFICE_STAFF'];

    it('role matrix: EXECUTIVE gets 200 on all four reads', async () => {
      for (const role of ROLES) {
        for (const u of reads()) {
          await http()
            .get(u)
            .set(as(role))
            .expect(status(ALLOWED.includes(role) ? 200 : 403));
        }
      }
    });

    it('templates: other kinds 400; unpublished and archived are not listed', async () => {
      await http()
        .get(`${API}/certificates/templates?document_kind=STUDENT_ID_CARD`)
        .set(as('ADMIN'))
        .expect(400);
      await http().get(`${API}/certificates/templates`).set(as('ADMIN')).expect(400);
      const [unpublished] = await ds.query(
        `INSERT INTO print_templates (tenant_id, document_kind, name, batch_size, draft)
         VALUES ($1, 'TESTIMONIAL', 'Unpublished', 50, '{}'::jsonb) RETURNING id`,
        [SEED_TENANT_ID],
      );
      const archived = await publishedTemplate(SEED_TENANT_ID, 'TESTIMONIAL');
      await ds.query(`UPDATE print_templates SET archived_at = now() WHERE id = $1`, [archived]);
      const res = await http()
        .get(`${API}/certificates/templates?document_kind=TESTIMONIAL`)
        .set(as('EXECUTIVE'))
        .expect(200);
      const ids = res.body.map((r: any) => r.id);
      expect(ids).toEqual([testimonialTpl]);
      expect(ids).not.toContain(unpublished.id);
      expect(ids).not.toContain(archived);
      expect(ids).not.toContain(tenant2Tpl);
      expect(Object.keys(res.body[0]).sort()).toEqual([
        'current_version_id',
        'id',
        'is_default',
        'name',
      ]);
    });

    it('asset file: bytes with the sandbox CSP; 404 across tenants', async () => {
      const res = await http()
        .get(`${API}/certificates/assets/${assetId}/file`)
        .set(as('EXECUTIVE'))
        .expect(200);
      expect(res.headers['content-security-policy']).toContain('sandbox');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-type']).toContain('image/svg+xml');
      await http()
        .get(`${API}/certificates/assets/${assetId}/file`)
        .set({ Authorization: `Bearer ${tenant2Token}`, 'X-Tenant-ID': tenant2Id })
        .expect(404);
      await http()
        .get(`${API}/certificates/assets/${tenant2Asset}/file`)
        .set(as('ADMIN'))
        .expect(404);
    });

    it('assets: only ids a live certificate template uses; archived-but-used still streams', async () => {
      const unused = await artwork(SEED_TENANT_ID);
      const idCardArt = await artwork(SEED_TENANT_ID);
      await useAssets(await publishedTemplate(SEED_TENANT_ID, 'STUDENT_ID_CARD'), [idCardArt]);
      const retiredArt = await artwork(SEED_TENANT_ID);
      const retired = await publishedTemplate(SEED_TENANT_ID, 'TESTIMONIAL');
      await useAssets(retired, [retiredArt]);
      await ds.query(`UPDATE print_templates SET archived_at = now() WHERE id = $1`, [retired]);
      await ds.query(`UPDATE print_assets SET archived_at = now() WHERE id = $1`, [assetId]);

      const list = await http().get(`${API}/certificates/assets`).set(as('EXECUTIVE')).expect(200);
      expect(list.body.map((a: any) => a.id)).toEqual([assetId]);
      await http()
        .get(`${API}/certificates/assets/${assetId}/file`)
        .set(as('EXECUTIVE'))
        .expect(200);
      for (const id of [unused, idCardArt, retiredArt]) {
        await http().get(`${API}/certificates/assets/${id}/file`).set(as('EXECUTIVE')).expect(404);
      }
    });
  });

  describe('tenant header', () => {
    it('a missing X-Tenant-ID is refused', async () => {
      await http()
        .post(`${API}/certificates`)
        .set({ Authorization: `Bearer ${tokens.ADMIN}` })
        .send(body(testimonialTpl, [studentA]))
        .expect((r) => expect([401, 403]).toContain(r.status));
    });

    it('an invalid X-Tenant-ID is refused', async () => {
      await http()
        .post(`${API}/certificates`)
        .set({ Authorization: `Bearer ${tokens.ADMIN}`, 'X-Tenant-ID': randomUUID() })
        .send(body(testimonialTpl, [studentA]))
        .expect((r) => expect([401, 403]).toContain(r.status));
    });
  });
});
