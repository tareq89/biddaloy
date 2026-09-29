import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Readable } from 'stream';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { PrintAssetKind } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { StorageService } from '../../storage/storage.service';
import { AuditService } from '../../audit/audit.service';
import { PrintAssetsService } from './print-assets.service';

/** [32.2.2] Real DB + in-memory object store: upload → list → stream,
 * cross-tenant 404, and archive keeps the object. */
describe('PrintAssetsService (integration)', () => {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const fakeStorage = {
    put: async (k: string, body: Buffer, contentType: string) =>
      void objects.set(k, { body, contentType }),
    get: async (k: string) => {
      const o = objects.get(k);
      if (!o) throw new Error('missing');
      return { body: Readable.from(o.body), contentType: o.contentType };
    },
    delete: async (k: string) => void objects.delete(k),
  };
  let ds: DataSource;
  let svc: PrintAssetsService;
  let userId: string;
  const tenants: string[] = [];

  const mkTenant = async () => {
    const rows = await ds.query(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
      `PA ${randomUUID()}`,
      `pa-${randomUUID()}`,
    ]);
    tenants.push(rows[0].id);
    return rows[0].id as string;
  };
  const png = () =>
    sharp({ create: { width: 6, height: 4, channels: 3, background: '#000' } })
      .png()
      .toBuffer();
  const upload = async (tenant: string) =>
    svc.upload(tenant, userId, PrintAssetKind.IMAGE, {
      buffer: await png(),
      originalname: 'seal.png',
      mimetype: 'image/png',
    } as Express.Multer.File);

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      PrintAssetsService,
      { provide: StorageService, useValue: fakeStorage },
      { provide: AuditService, useValue: { record: async () => undefined } },
    ]);
    ds = module.get(DataSource);
    svc = module.get(PrintAssetsService);
    const u = await ds.query(`INSERT INTO users (full_name) VALUES ($1) RETURNING id`, [
      `PA ${randomUUID()}`,
    ]);
    userId = u[0].id;
  });

  afterAll(async () => {
    for (const t of tenants) await ds.query(`DELETE FROM print_assets WHERE tenant_id = $1`, [t]);
    await ds.query(`DELETE FROM users WHERE id = $1`, [userId]);
    for (const t of tenants) await ds.query(`DELETE FROM schools WHERE id = $1`, [t]);
    await ds.destroy();
  });

  it('upload → list → stream round trip', async () => {
    const t = await mkTenant();
    const a = await upload(t);
    const listed = await svc.list(t, PrintAssetKind.IMAGE);
    expect(listed.map((r) => r.id)).toEqual([a.id]);
    expect(await svc.list(t, PrintAssetKind.FONT)).toEqual([]);

    const { asset, object } = await svc.getFile(a.id, t);
    const chunks: Buffer[] = [];
    for await (const c of object.body as Readable) chunks.push(Buffer.from(c));
    expect(Buffer.concat(chunks).length).toBe(asset.byte_size);
    expect(asset).toMatchObject({ content_type: 'image/png', width_px: 6, height_px: 4 });
  });

  it("tenant B gets 404 on tenant A's asset", async () => {
    const [ta, tb] = [await mkTenant(), await mkTenant()];
    const a = await upload(ta);
    await expect(svc.getFile(a.id, tb)).rejects.toThrow(NotFoundException);
    await expect(svc.archive(a.id, tb, userId)).rejects.toThrow(NotFoundException);
    expect(await svc.list(tb)).toEqual([]);
  });

  it('archive hides from list but keeps the object streamable', async () => {
    const t = await mkTenant();
    const a = await upload(t);
    await svc.archive(a.id, t, userId);
    expect(await svc.list(t)).toEqual([]);
    expect(objects.has(a.storage_key)).toBe(true);
    await expect(svc.getFile(a.id, t)).resolves.toBeDefined();
  });
});
