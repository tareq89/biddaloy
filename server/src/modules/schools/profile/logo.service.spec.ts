import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import { AuditAction } from '@biddaloy/shared';
import { SchoolLogoService } from './logo.service';

const REQUEST_CONTEXT = { ip: '10.0.0.1', userAgent: 'vitest' };
const SCHOOL_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

function fakeRepo(school: Record<string, unknown> | null) {
  const schoolRepo = {
    createQueryBuilder: vi.fn(() => ({
      where: vi.fn().mockReturnThis(),
      setLock: vi.fn().mockReturnThis(),
      getOne: vi.fn(async () => school),
    })),
    save: vi.fn(async (s: typeof school) => s),
  };
  const manager = { getRepository: vi.fn(() => schoolRepo) };
  return {
    manager: { transaction: vi.fn(async (cb: any) => cb(manager)) },
    schoolRepo,
  };
}

function fakeStorage() {
  return { put: vi.fn(), get: vi.fn(), delete: vi.fn(), exists: vi.fn() };
}

function fakeAuditService() {
  return { record: vi.fn() };
}

/** A real PNG so `sharp(...).metadata()` reflects genuine format/size
 * detection rather than a mock — this is the whole point of [15.5.3]'s
 * "ignore the browser MIME, trust the bytes" contract. */
async function realPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

describe('SchoolLogoService', () => {
  let storage: ReturnType<typeof fakeStorage>;
  let auditService: ReturnType<typeof fakeAuditService>;

  beforeEach(() => {
    storage = fakeStorage();
    auditService = fakeAuditService();
  });

  describe('upload', () => {
    it('accepts a valid PNG regardless of its declared MIME (there is none — sharp reads bytes), stores and audits it', async () => {
      const repo = fakeRepo({ id: SCHOOL_ID, logo_key: null });
      const service = new SchoolLogoService(repo as any, storage as any, auditService as any);
      const png = await realPng(100, 100);

      const result = await service.upload(SCHOOL_ID, png, 'user-1', REQUEST_CONTEXT);

      expect(result.logo_url).toMatch(new RegExp(`^/schools/${SCHOOL_ID}/logo\\?v=`));
      expect(storage.put).toHaveBeenCalledTimes(1);
      const [key, buf, contentType] = storage.put.mock.calls[0];
      expect(key).toMatch(new RegExp(`^tenants/${SCHOOL_ID}/logo/.+\\.png$`));
      expect(contentType).toBe('image/png');
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.UPDATE,
          entity_type: 'School',
          old_values: { logo_key: null },
          new_values: { logo_key: key },
        }),
        expect.anything(),
      );
    });

    it('rejects a non-image file even when named/sent as a PNG', async () => {
      const repo = fakeRepo({ id: SCHOOL_ID, logo_key: null });
      const service = new SchoolLogoService(repo as any, storage as any, auditService as any);
      const notAnImage = Buffer.from('this is just text, not image bytes');

      await expect(
        service.upload(SCHOOL_ID, notAnImage, 'user-1', REQUEST_CONTEXT),
      ).rejects.toThrow(BadRequestException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('rejects an image bigger than 2048px per side', async () => {
      const repo = fakeRepo({ id: SCHOOL_ID, logo_key: null });
      const service = new SchoolLogoService(repo as any, storage as any, auditService as any);
      const huge = await realPng(3000, 100);

      await expect(service.upload(SCHOOL_ID, huge, 'user-1', REQUEST_CONTEXT)).rejects.toThrow(
        BadRequestException,
      );
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('deletes the previous logo object only after the new key is committed', async () => {
      const repo = fakeRepo({ id: SCHOOL_ID, logo_key: 'tenants/x/logo/old.png' });
      const service = new SchoolLogoService(repo as any, storage as any, auditService as any);
      const png = await realPng(50, 50);

      await service.upload(SCHOOL_ID, png, 'user-1', REQUEST_CONTEXT);

      expect(storage.delete).toHaveBeenCalledWith('tenants/x/logo/old.png');
      // put (new object) must have happened before delete (old object) —
      // the replace is add-then-remove, never remove-then-add.
      const putOrder = storage.put.mock.invocationCallOrder[0];
      const deleteOrder = storage.delete.mock.invocationCallOrder[0];
      expect(putOrder).toBeLessThan(deleteOrder);
    });

    it('throws NotFoundException for a missing school', async () => {
      const repo = fakeRepo(null);
      const service = new SchoolLogoService(repo as any, storage as any, auditService as any);
      const png = await realPng(50, 50);

      await expect(service.upload(SCHOOL_ID, png, 'user-1', REQUEST_CONTEXT)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('nulls the column, audits, and deletes the object after commit', async () => {
      const repo = fakeRepo({ id: SCHOOL_ID, logo_key: 'tenants/x/logo/old.png' });
      const service = new SchoolLogoService(repo as any, storage as any, auditService as any);

      await service.remove(SCHOOL_ID, 'user-1', REQUEST_CONTEXT);

      expect(repo.schoolRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ logo_key: null }),
      );
      expect(storage.delete).toHaveBeenCalledWith('tenants/x/logo/old.png');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          old_values: { logo_key: 'tenants/x/logo/old.png' },
          new_values: { logo_key: null },
        }),
        expect.anything(),
      );
    });

    it('no-ops (no delete, no audit) when there was no logo', async () => {
      const repo = fakeRepo({ id: SCHOOL_ID, logo_key: null });
      const service = new SchoolLogoService(repo as any, storage as any, auditService as any);

      await service.remove(SCHOOL_ID, 'user-1', REQUEST_CONTEXT);

      expect(storage.delete).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });
  });
});
