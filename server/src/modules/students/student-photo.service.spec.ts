import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { AuditAction } from '@biddaloy/shared';
import { StudentPhotoService } from './student-photo.service';

const TENANT = 'aaaaaaaa-0000-4000-8000-000000000001';
const USER = 'bbbbbbbb-0000-4000-8000-000000000002';

type Row = { id: string; full_name: string; registration_number: string; photo_key: string | null };

function setup(students: Row[]) {
  const txRepo = {
    createQueryBuilder: vi.fn(() => {
      let id = '';
      const qb: any = {
        where: vi.fn((_sql: string, p: { id: string }) => {
          id = p.id;
          return qb;
        }),
        setLock: vi.fn(() => qb),
        getOne: vi.fn(async () => students.find((s) => s.id === id) ?? null),
      };
      return qb;
    }),
    save: vi.fn(async (s: Row) => s),
  };
  const manager = { getRepository: vi.fn(() => txRepo) };
  const repo = {
    findOne: vi.fn(
      async ({ where }: any) =>
        students.find(
          (s) =>
            (where.id === undefined || s.id === where.id) &&
            (where.registration_number === undefined ||
              s.registration_number === where.registration_number),
        ) ?? null,
    ),
    // one transaction call per stored file — asserted below
    manager: { transaction: vi.fn(async (cb: any) => cb(manager)) },
  };
  const storage = { put: vi.fn(), get: vi.fn() };
  const audit = { record: vi.fn() };
  const service = new StudentPhotoService(repo as any, storage as any, audit as any);
  return { service, repo, storage, audit, txRepo };
}

const student = (id: string, reg: string, photo_key: string | null = null): Row => ({
  id,
  full_name: `Student ${reg}`,
  registration_number: reg,
  photo_key,
});

const png = (w = 100, h = 100) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#f00' } })
    .png()
    .toBuffer();

describe('StudentPhotoService', () => {
  let s1: Row;
  beforeEach(() => {
    s1 = student('s1', 'REG-1');
  });

  it('ignores a lying mimetype: a PNG uploaded as ".pdf" is accepted and re-encoded to JPEG', async () => {
    const { service, storage } = setup([s1]);
    await service.upload('s1', await png(), TENANT, USER);
    const [key, body, type] = storage.put.mock.calls[0];
    expect(key).toMatch(new RegExp(`^tenants/${TENANT}/student-photo/.+\\.jpg$`));
    expect(type).toBe('image/jpeg');
    expect((await sharp(body).metadata()).format).toBe('jpeg');
  });

  it('rejects a PDF and stores nothing', async () => {
    const { service, storage } = setup([s1]);
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
    await expect(service.upload('s1', pdf, TENANT, USER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('applies EXIF orientation (landscape source tagged 6 becomes portrait)', async () => {
    const { service, storage } = setup([s1]);
    const rotated = await sharp({
      create: { width: 200, height: 100, channels: 3, background: '#0f0' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    await service.upload('s1', rotated, TENANT, USER);
    const out = await sharp(storage.put.mock.calls[0][1]).metadata();
    expect([out.width, out.height]).toEqual([100, 200]);
  });

  it('downsizes to 800px on the long side', async () => {
    const { service, storage } = setup([s1]);
    await service.upload('s1', await png(2000, 1000), TENANT, USER);
    const out = await sharp(storage.put.mock.calls[0][1]).metadata();
    expect([out.width, out.height]).toEqual([800, 400]);
  });

  it('rejects an image over 6000px per side', async () => {
    const { service } = setup([s1]);
    const big = await sharp({
      create: { width: 6001, height: 1, channels: 3, background: '#000' },
    })
      .png()
      .toBuffer();
    await expect(service.upload('s1', big, TENANT, USER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('keeps the old object on replacement (D48): repoints the key, never deletes', async () => {
    const withPhoto = student('s1', 'REG-1', 'tenants/x/student-photo/old.jpg');
    const { service, storage, txRepo, audit } = setup([withPhoto]);
    (storage as any).delete = vi.fn();
    await service.upload('s1', await png(), TENANT, USER);
    const saved = txRepo.save.mock.calls[0][0];
    expect(saved.photo_key).not.toBe('tenants/x/student-photo/old.jpg');
    expect(saved.photo_key).toContain('/student-photo/');
    expect((storage as any).delete).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.UPDATE,
        entity_type: 'Student',
        entity_id: 's1',
        tenant_id: TENANT,
        performed_by_user_id: USER,
        new_values: { photo: true },
      }),
      expect.anything(),
    );
  });

  it('bulk: 1 matched, 1 unmatched stem, 1 corrupt reported invalid; matched one still saved, each in its own transaction', async () => {
    const s2 = student('s2', 'REG-2');
    const { service, repo, txRepo } = setup([s1, s2]);
    const res = await service.bulkUpload(
      [
        { originalname: ' REG-1 .png', buffer: await png() },
        { originalname: 'NOPE.jpg', buffer: await png() },
        { originalname: 'REG-2.jpg', buffer: Buffer.from('not an image') },
      ],
      TENANT,
      USER,
    );
    expect(res.matched).toEqual([
      { file: ' REG-1 .png', student_id: 's1', full_name: 'Student REG-1' },
    ]);
    expect(res.unmatched).toEqual(['NOPE.jpg']);
    expect(res.invalid).toEqual([{ file: 'REG-2.jpg', reason: expect.any(String) }]);
    expect(txRepo.save).toHaveBeenCalledTimes(1);
    expect(repo.manager.transaction).toHaveBeenCalledTimes(1);
  });

  it('bulk: match query is scoped by tenant_id', async () => {
    const { service, repo } = setup([s1]);
    await service.bulkUpload([{ originalname: 'REG-1.png', buffer: await png() }], TENANT, USER);
    expect(repo.findOne.mock.calls[0][0].where).toMatchObject({
      registration_number: 'REG-1',
      tenant_id: TENANT,
    });
  });
});
