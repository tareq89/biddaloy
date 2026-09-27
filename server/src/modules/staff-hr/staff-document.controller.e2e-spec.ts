import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { UserRole } from '@biddaloy/shared';
import { StorageService } from '../storage/storage.service';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/** In-memory fake so this spec covers routing/auth/tenant scoping, not a
 * real S3 endpoint — same rationale as `staff-hr.controller.e2e-spec.ts`'s
 * override for `logo.e2e-spec.ts`. */
class FakeStorageService {
  private objects = new Map<string, { body: Buffer; contentType: string }>();
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
  }
  async get(key: string): Promise<{ body: Buffer; contentType: string }> {
    const obj = this.objects.get(key);
    if (!obj) throw new Error(`no object for key ${key}`);
    return obj;
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }
}

/**
 * E2E for [23.6]'s `POST/GET /staff-documents`: upload→download round trip,
 * a non-ADMIN/`STAFF_HR_MANAGE` caller denied on upload, missing
 * `X-Tenant-ID` rejected, and tenant isolation on download (a genuine
 * tenant-B admin can never fetch tenant-A's document by id).
 */
const API = '/api/v1';
const TENANT_A = SEED_TENANT_ID;
const TENANT_B = '00000000-0000-4000-8000-000000000410';
const STAFF_USER_ID = '00000000-0000-4000-8000-000000000411';
const STAFF_EMAIL = 'staff-document-e2e-staff@testschool.example';
const TEACHER_USER_ID = '00000000-0000-4000-8000-000000000412';
const TEACHER_EMAIL = 'staff-document-e2e-teacher@testschool.example';
const OUTSIDER_USER_ID = '00000000-0000-4000-8000-000000000413';
const OUTSIDER_EMAIL = 'staff-document-e2e-outsider@testschool.example';

describe('StaffDocument E2E (23.6)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let teacherToken: string;
  let tenantBToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StorageService)
      .useClass(FakeStorageService)
      .compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Staff Document E2E Tenant B', 'staff-document-e2e-tenant-b', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_B, UserRole.ADMIN],
    );

    // The staff member (tenant A member) the document is uploaded for.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Staff Document E2E Staff', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [STAFF_USER_ID, STAFF_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [STAFF_USER_ID, TENANT_A, UserRole.TEACHER],
    );

    // A genuine non-ADMIN tenant-A user, to prove real RBAC denial on upload.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Staff Document E2E Teacher', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, TEACHER_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, TENANT_A, UserRole.TEACHER],
    );

    // A genuine tenant-A-only user with no membership anywhere else — used
    // to prove a tenant-A admin can't attach a document to a user who isn't
    // actually a member of tenant A.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Staff Document E2E Outsider', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OUTSIDER_USER_ID, OUTSIDER_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );

    const loginRes = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = loginRes.body.access_token;
    tenantBToken = adminToken; // same user, genuine membership in both tenants

    const teacherLoginRes = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: TEACHER_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    teacherToken = teacherLoginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await dataSource.query(`DELETE FROM staff_documents WHERE tenant_id IN ($1, $2)`, [
      TENANT_A,
      TENANT_B,
    ]);
    await app.close();
  });

  it('an admin uploads a document, then downloads it back', async () => {
    const uploadRes = await supertest(app.getHttpServer())
      .post(`${API}/staff-documents/${STAFF_USER_ID}/NID`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .set('X-Role', UserRole.ADMIN)
      .attach('file', Buffer.from('%PDF-1.4 test'), {
        filename: 'nid.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    expect(uploadRes.body.document_type).toBe('NID');
    const docId = uploadRes.body.id;

    const downloadRes = await supertest(app.getHttpServer())
      .get(`${API}/staff-documents/download/${docId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .set('X-Role', UserRole.ADMIN)
      .expect(200);

    expect(downloadRes.headers['content-disposition']).toContain('nid.pdf');
    expect(downloadRes.body.toString()).toBe('%PDF-1.4 test');

    const listRes = await supertest(app.getHttpServer())
      .get(`${API}/staff-documents/${STAFF_USER_ID}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .set('X-Role', UserRole.ADMIN)
      .expect(200);
    expect(listRes.body).toHaveLength(1);
  });

  it('rejects upload for a staff_user_id that is not a member of the caller tenant', async () => {
    await supertest(app.getHttpServer())
      .post(`${API}/staff-documents/${OUTSIDER_USER_ID}/NID`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .set('X-Role', UserRole.ADMIN)
      .attach('file', Buffer.from('%PDF-1.4 test'), {
        filename: 'nid.pdf',
        contentType: 'application/pdf',
      })
      .expect(403);
  });

  it('rejects a non-ADMIN caller (RolesGuard)', async () => {
    await supertest(app.getHttpServer())
      .post(`${API}/staff-documents/${STAFF_USER_ID}/NID`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .set('X-Role', UserRole.TEACHER)
      .attach('file', Buffer.from('%PDF-1.4 test'), {
        filename: 'nid.pdf',
        contentType: 'application/pdf',
      })
      // RolesGuard throws UnauthorizedException (401), not ForbiddenException,
      // for a role that doesn't match @Roles() — see context.guard.ts.
      .expect(401);
  });

  it('rejects a request with no X-Tenant-ID header', async () => {
    await supertest(app.getHttpServer())
      .post(`${API}/staff-documents/${STAFF_USER_ID}/NID`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Role', UserRole.ADMIN)
      .attach('file', Buffer.from('%PDF-1.4 test'), {
        filename: 'nid.pdf',
        contentType: 'application/pdf',
      })
      // ContextGuard throws UnauthorizedException (401) for a missing
      // X-Tenant-ID header — see context.guard.ts.
      .expect(401);
  });

  it("tenant isolation: a tenant-B admin cannot download tenant-A's document by id", async () => {
    const uploadRes = await supertest(app.getHttpServer())
      .post(`${API}/staff-documents/${STAFF_USER_ID}/PHOTO`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .set('X-Role', UserRole.ADMIN)
      .attach(
        'file',
        Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from(' test')]),
        { filename: 'photo.png', contentType: 'image/png' },
      )
      .expect(201);
    const docId = uploadRes.body.id;

    await supertest(app.getHttpServer())
      .get(`${API}/staff-documents/download/${docId}`)
      .set('Authorization', `Bearer ${tenantBToken}`)
      .set('X-Tenant-ID', TENANT_B)
      .set('X-Role', UserRole.ADMIN)
      .expect(404);

    await supertest(app.getHttpServer())
      .get(`${API}/staff-documents/download/${docId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .set('X-Role', UserRole.ADMIN)
      .expect(200);
  });

  /**
   * [23.7] The full upload -> list -> download -> replace journey, with the
   * orphan-cleanup check the ticket's AC calls for: after a same-type
   * re-upload, exactly one object remains in `FakeStorageService`'s store
   * for this document — the old one is gone, not just unlinked from the row.
   */
  it('replaces a document of the same type and leaves no orphaned storage object', async () => {
    const storage = app.get(StorageService) as unknown as FakeStorageService;

    const firstUpload = await supertest(app.getHttpServer())
      .post(`${API}/staff-documents/${STAFF_USER_ID}/BIRTH_CERTIFICATE`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .set('X-Role', UserRole.ADMIN)
      .attach('file', Buffer.from('%PDF-1.4 first'), {
        filename: 'birth-cert-v1.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    const firstStorageKeysBefore = (storage as unknown as { objects: Map<string, unknown> }).objects
      .size;

    const listAfterFirst = await supertest(app.getHttpServer())
      .get(`${API}/staff-documents/${STAFF_USER_ID}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .set('X-Role', UserRole.ADMIN)
      .expect(200);
    expect(
      listAfterFirst.body.some(
        (d: { id: string; document_type: string }) => d.id === firstUpload.body.id,
      ),
    ).toBe(true);

    const downloadFirst = await supertest(app.getHttpServer())
      .get(`${API}/staff-documents/download/${firstUpload.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .set('X-Role', UserRole.ADMIN)
      .expect(200);
    expect(downloadFirst.body.toString()).toBe('%PDF-1.4 first');

    // Same staff member, same document type -> replace, not a second row.
    const secondUpload = await supertest(app.getHttpServer())
      .post(`${API}/staff-documents/${STAFF_USER_ID}/BIRTH_CERTIFICATE`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .set('X-Role', UserRole.ADMIN)
      .attach('file', Buffer.from('%PDF-1.4 second'), {
        filename: 'birth-cert-v2.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    expect(secondUpload.body.id).toBe(firstUpload.body.id);

    const downloadSecond = await supertest(app.getHttpServer())
      .get(`${API}/staff-documents/download/${secondUpload.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .set('X-Role', UserRole.ADMIN)
      .expect(200);
    expect(downloadSecond.headers['content-disposition']).toContain('birth-cert-v2.pdf');
    expect(downloadSecond.body.toString()).toBe('%PDF-1.4 second');

    // Still exactly one row for this (staff, type) pair.
    const listAfterReplace = await supertest(app.getHttpServer())
      .get(`${API}/staff-documents/${STAFF_USER_ID}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .set('X-Role', UserRole.ADMIN)
      .expect(200);
    expect(
      listAfterReplace.body.filter(
        (d: { document_type: string }) => d.document_type === 'BIRTH_CERTIFICATE',
      ),
    ).toHaveLength(1);

    // The orphan check: the replace must not leave the store larger than
    // it was after the first upload — the old object was deleted, not
    // just superseded in the row.
    const storageKeysAfterReplace = (storage as unknown as { objects: Map<string, unknown> })
      .objects.size;
    expect(storageKeysAfterReplace).toBe(firstStorageKeysBefore);
  });
});
