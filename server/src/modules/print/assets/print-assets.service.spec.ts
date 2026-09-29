import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import { AuditAction, PrintAssetKind } from '@biddaloy/shared';
import { PrintAssetsService } from './print-assets.service';

const TENANT_A = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const TENANT_B = 'a1b2c3d4-5717-4562-b3fc-2c963f66afa6';
const USER = 'user-1';

const png = (w = 4, h = 3) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#fff' } })
    .png()
    .toBuffer();

const file = (buffer: Buffer, over: Partial<Express.Multer.File> = {}) =>
  ({
    buffer,
    mimetype: 'application/octet-stream',
    originalname: 'x.bin',
    size: buffer.length,
    ...over,
  }) as Express.Multer.File;

function setup(saveImpl?: () => Promise<unknown>) {
  const rows: any[] = [];
  const repo = {
    create: vi.fn((v: object) => ({ id: 'asset-1', ...v })),
    save: vi.fn(saveImpl ?? (async (v: object) => (rows.push(v), v))),
    find: vi.fn(),
    findOne: vi.fn(
      async ({ where }: any) =>
        rows.find((r) => r.id === where.id && r.tenant_id === where.tenant_id) ?? null,
    ),
  };
  const storage = {
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    get: vi.fn(),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const svc = new PrintAssetsService(repo as any, storage as any, audit as any);
  return { svc, repo, storage, audit, rows };
}

describe('PrintAssetsService.upload', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });

  it('rejects a PNG renamed .ttf as a font', async () => {
    await expect(
      s.svc.upload(
        TENANT_A,
        USER,
        PrintAssetKind.FONT,
        file(await png(), { originalname: 'a.ttf', mimetype: 'font/ttf' }),
        'Noto',
      ),
    ).rejects.toThrow(/TTF, OTF or WOFF2/);
    expect(s.storage.put).not.toHaveBeenCalled();
  });

  it('ignores a lying mimetype: a PNG declared as image/jpeg is stored as png', async () => {
    const saved = await s.svc.upload(
      TENANT_A,
      USER,
      PrintAssetKind.IMAGE,
      file(await png(), { mimetype: 'image/jpeg', originalname: 'seal.jpg' }),
    );
    expect(saved.content_type).toBe('image/png');
    expect(saved.width_px).toBe(4);
    expect(saved.original_name).toBe('seal.jpg');
    expect(s.storage.put).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^tenants/${TENANT_A}/print-image/.+\\.png$`)),
      expect.any(Buffer),
      'image/png',
    );
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.CREATE, entity_type: 'PrintAsset' }),
    );
  });

  it('rejects non-image bytes declared as image/png', async () => {
    await expect(
      s.svc.upload(
        TENANT_A,
        USER,
        PrintAssetKind.IMAGE,
        file(Buffer.from('hello'), { mimetype: 'image/png' }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('deletes the uploaded object when the insert fails', async () => {
    const f = setup(async () => {
      throw new Error('db down');
    });
    await expect(
      f.svc.upload(TENANT_A, USER, PrintAssetKind.IMAGE, file(await png())),
    ).rejects.toThrow('db down');
    const key = (f.storage.put.mock.calls as any)[0][0];
    expect(f.storage.delete).toHaveBeenCalledWith(key);
    expect(f.audit.record).not.toHaveBeenCalled();
  });

  it('accepts a font by magic bytes and requires a valid font_family', async () => {
    const font = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(32)]);
    const saved = await s.svc.upload(
      TENANT_A,
      USER,
      PrintAssetKind.FONT,
      file(font),
      'Noto Sans-1',
    );
    expect(saved).toMatchObject({ content_type: 'font/woff2', font_family: 'Noto Sans-1' });
    await expect(s.svc.upload(TENANT_A, USER, PrintAssetKind.FONT, file(font))).rejects.toThrow(
      /font_family/,
    );
    await expect(
      s.svc.upload(TENANT_A, USER, PrintAssetKind.FONT, file(font), 'bad<name>'),
    ).rejects.toThrow(/font_family/);
  });

  it('sanitizes SVG artwork before storing it', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"><script>x()</script><rect width="1" height="1"/></svg>',
    );
    const saved = await s.svc.upload(TENANT_A, USER, PrintAssetKind.ARTWORK, file(svg));
    expect(saved).toMatchObject({ content_type: 'image/svg+xml', width_px: 10, height_px: 5 });
    const stored = ((s.storage.put.mock.calls as any)[0][1] as Buffer).toString();
    expect(stored).not.toContain('script');
  });

  it('treats a PNG whose metadata contains "<svg" as a PNG, not an SVG', async () => {
    const tagged = await sharp({
      create: { width: 4, height: 3, channels: 3, background: '#fff' },
    })
      .withExif({ IFD0: { ImageDescription: '<svg viewBox="0 0 1 1">' } })
      .png()
      .toBuffer();
    const saved = await s.svc.upload(TENANT_A, USER, PrintAssetKind.ARTWORK, file(tagged));
    expect(saved.content_type).toBe('image/png');
  });

  it('rejects artwork over 8000px and an unknown kind', async () => {
    await expect(
      s.svc.upload(TENANT_A, USER, PrintAssetKind.ARTWORK, file(await png(8001, 1))),
    ).rejects.toThrow(/8000px/);
    await expect(s.svc.upload(TENANT_A, USER, 'NOPE', file(await png()))).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('PrintAssetsService tenant scoping', () => {
  it('getFile and archive are 404 for another tenant', async () => {
    const s = setup();
    const a = await s.svc.upload(TENANT_A, USER, PrintAssetKind.IMAGE, file(await png()));
    await expect(s.svc.getFile(a.id, TENANT_B)).rejects.toThrow(NotFoundException);
    await expect(s.svc.archive(a.id, TENANT_B, USER)).rejects.toThrow(NotFoundException);
  });

  it('archive sets archived_at and never deletes the object', async () => {
    const s = setup();
    const a = await s.svc.upload(TENANT_A, USER, PrintAssetKind.IMAGE, file(await png()));
    const out = await s.svc.archive(a.id, TENANT_A, USER);
    expect(out.archived_at).toBeInstanceOf(Date);
    expect(s.storage.delete).not.toHaveBeenCalled();
  });
});
