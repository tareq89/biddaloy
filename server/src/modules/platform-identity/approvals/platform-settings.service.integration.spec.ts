import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { TestingModule } from '@nestjs/testing';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../audit/audit.service';
import { PlatformSettingsService } from './platform-settings.service';

const KEY = `test.concurrent.${Math.floor(Math.random() * 1e6)}`;

describe('PlatformSettingsService.update (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let svc: PlatformSettingsService;

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, [PlatformSettingsService, AuditService]);
    ds = module.get<DataSource>(getDataSourceToken());
    svc = module.get(PlatformSettingsService);
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM platform_settings WHERE key = $1`, [KEY]);
    await module.close();
  });

  it('overlapping PUTs from two service instances both persist (no lost update)', async () => {
    // A second instance stands in for the second API container; they share only Postgres.
    const other = new PlatformSettingsService(
      (svc as any).repo,
      (svc as any).audit,
      (svc as any).dataSource,
    );
    // Delay right after each read so, without the lock, both would read {} before either writes.
    for (const inst of [svc, other]) {
      const read = inst.get.bind(inst);
      inst.get = (async (k: string, m?: any) => {
        const v = await read(k, m);
        await new Promise((r) => setTimeout(r, 150));
        return v;
      }) as typeof inst.get;
    }
    const merge = (patch: object) => (old: unknown) => ({ ...((old as object) ?? {}), ...patch });
    await Promise.all([
      svc.update(KEY, merge({ sms: 1 }), null as never),
      other.update(KEY, merge({ email: 2 }), null as never),
    ]);
    const [row] = await ds.query(`SELECT value FROM platform_settings WHERE key = $1`, [KEY]);
    expect(row.value).toEqual({ sms: 1, email: 2 });
  });
});
