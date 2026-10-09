import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { StaffDocumentService } from './staff-document.service';
import { StaffDocument } from './entities/staff-document.entity';
import { AuditAction, StaffDocumentType } from '@biddaloy/shared';

/**
 * Unit tests for [23.6]'s `StaffDocumentService`: upload stores the object
 * and row, replacing a document orphan-deletes the old S3 object (matching
 * homework's resubmission fix), and download is tenant-scoped.
 */

const TENANT_A = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const TENANT_B = 'a1b2c3d4-5717-4562-b3fc-2c963f66afa6';
const STAFF_USER = 'staff-1';
const UPLOADER = 'admin-1';

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    buffer: Buffer.from('%PDF-1.4 hello'),
    mimetype: 'application/pdf',
    originalname: 'nid.pdf',
    size: 5,
    ...overrides,
  } as Express.Multer.File;
}

function createRepoStub(existing: StaffDocument[] = []) {
  const rows = [...existing];
  return {
    findOne: vi.fn(async ({ where }: any) => {
      return (
        rows.find(
          (r) =>
            r.tenant_id === where.tenant_id &&
            (where.staff_user_id === undefined || r.staff_user_id === where.staff_user_id) &&
            (where.document_type === undefined || r.document_type === where.document_type) &&
            (where.id === undefined || r.id === where.id),
        ) ?? null
      );
    }),
    create: vi.fn((v: any) => ({ ...v })),
    save: vi.fn(async (v: any) => {
      const withId = { id: v.id ?? `doc-${rows.length + 1}`, ...v };
      const idx = rows.findIndex((r) => r.id === withId.id);
      if (idx >= 0) rows[idx] = withId;
      else rows.push(withId);
      return withId;
    }),
    find: vi.fn(async ({ where }: any) =>
      rows.filter(
        (r) => r.tenant_id === where.tenant_id && r.staff_user_id === where.staff_user_id,
      ),
    ),
  };
}

function createStorageStub() {
  return {
    put: vi.fn(async () => undefined),
    get: vi.fn(async () => ({ body: Buffer.from('data'), contentType: 'application/pdf' })),
    delete: vi.fn(async () => undefined),
    exists: vi.fn(async () => true),
  };
}

function createAuditStub() {
  return { record: vi.fn(async () => undefined) };
}

describe('StaffDocumentService', () => {
  let repo: ReturnType<typeof createRepoStub>;
  let storage: ReturnType<typeof createStorageStub>;
  let audit: ReturnType<typeof createAuditStub>;
  let service: StaffDocumentService;

  beforeEach(() => {
    repo = createRepoStub();
    storage = createStorageStub();
    audit = createAuditStub();
    service = new StaffDocumentService(repo as any, storage as any, audit as any);
  });

  it('uploads a new document: puts the object, saves the row, records an audit entry', async () => {
    const file = makeFile();
    const doc = await service.upload(STAFF_USER, StaffDocumentType.NID, file, {
      userId: UPLOADER,
      tenantId: TENANT_A,
    });

    expect(storage.put).toHaveBeenCalledOnce();
    expect(doc.tenant_id).toBe(TENANT_A);
    expect(doc.staff_user_id).toBe(STAFF_USER);
    expect(doc.document_type).toBe(StaffDocumentType.NID);
    expect(audit.record).toHaveBeenCalledOnce();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('replacing a document deletes the old S3 object (no orphan)', async () => {
    const first = await service.upload(STAFF_USER, StaffDocumentType.NID, makeFile(), {
      userId: UPLOADER,
      tenantId: TENANT_A,
    });
    const oldKey = first.storage_key;

    await service.upload(
      STAFF_USER,
      StaffDocumentType.NID,
      makeFile({ originalname: 'nid-2.pdf' }),
      {
        userId: UPLOADER,
        tenantId: TENANT_A,
      },
    );

    expect(storage.delete).toHaveBeenCalledWith(oldKey);
    expect(storage.put).toHaveBeenCalledTimes(2);
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: AuditAction.UPDATE }),
    );
  });

  it('records CREATE on first upload', async () => {
    await service.upload(STAFF_USER, StaffDocumentType.NID, makeFile(), {
      userId: UPLOADER,
      tenantId: TENANT_A,
    });
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: AuditAction.CREATE }),
    );
  });

  it('deletes the just-uploaded object if the row save fails (no orphan)', async () => {
    repo.save.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.upload(STAFF_USER, StaffDocumentType.NID, makeFile(), {
        userId: UPLOADER,
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow('db down');
    expect(storage.delete).toHaveBeenCalledOnce();
  });

  it('rejects a disallowed mime type', async () => {
    await expect(
      service.upload(STAFF_USER, StaffDocumentType.NID, makeFile({ mimetype: 'text/plain' }), {
        userId: UPLOADER,
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow('File must be PDF, JPG, PNG or WebP');
  });

  it('rejects a file whose content does not match its declared mimetype', async () => {
    await expect(
      service.upload(
        STAFF_USER,
        StaffDocumentType.NID,
        makeFile({ mimetype: 'image/png', buffer: Buffer.from('%PDF-1.4 hello') }),
        { userId: UPLOADER, tenantId: TENANT_A },
      ),
    ).rejects.toThrow('File content does not match its declared type');
  });

  it('enforces tenant isolation on download: tenant B cannot fetch tenant A document by id', async () => {
    const doc = await service.upload(STAFF_USER, StaffDocumentType.NID, makeFile(), {
      userId: UPLOADER,
      tenantId: TENANT_A,
    });

    await expect(service.download(doc.id, TENANT_B)).rejects.toThrow(NotFoundException);

    const ok = await service.download(doc.id, TENANT_A);
    expect(ok.doc.id).toBe(doc.id);
    expect(storage.get).toHaveBeenCalledWith(doc.storage_key);
  });
});
