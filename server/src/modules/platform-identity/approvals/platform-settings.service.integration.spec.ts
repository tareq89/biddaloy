import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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
    // Deterministic hold: `svc` starts first and pauses after its read. `other` is started only
    // once `svc` has read, and `svc` is released only when `other` is provably racing it —
    // either `other` has also read (no lock: both saw {}) or `other` is queued on THIS key's
    // advisory lock (lock held: it cannot read yet). No timing involved.
    let svcRead!: () => void;
    const svcHasRead = new Promise<void>((r) => (svcRead = r));
    let otherRead = false;
    const otherQueuedOnLock = async () => {
      const rows = await ds.query(
        `SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted
           AND ((classid::bigint << 32) | objid::bigint) = hashtext($1)::bigint LIMIT 1`,
        [`platform_settings:${KEY}`],
      );
      return rows.length > 0;
    };
    const readSvc = svc.get.bind(svc);
    svc.get = (async (k: string, m?: any) => {
      const v = await readSvc(k, m);
      svcRead();
      await vi.waitFor(
        async () => {
          if (!otherRead && !(await otherQueuedOnLock())) throw new Error('other not racing yet');
        },
        { timeout: 10_000, interval: 10 },
      );
      return v;
    }) as typeof svc.get;
    const readOther = other.get.bind(other);
    other.get = (async (k: string, m?: any) => {
      const v = await readOther(k, m);
      otherRead = true;
      return v;
    }) as typeof other.get;
    const merge = (patch: object) => (old: unknown) => ({ ...((old as object) ?? {}), ...patch });
    const first = svc.update(KEY, merge({ sms: 1 }), null as never);
    await svcHasRead;
    const second = other.update(KEY, merge({ email: 2 }), null as never);
    await Promise.all([first, second]);
    const [row] = await ds.query(`SELECT value FROM platform_settings WHERE key = $1`, [KEY]);
    expect(row.value).toEqual({ sms: 1, email: 2 });
  });
});
