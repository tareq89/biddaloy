import { describe, it, expect, vi } from 'vitest';
import { AcrCriteriaService } from './acr-criteria.service';

const A = 'tenant-a';
const B = 'tenant-b';
const crit = (code: string, block: 'BLOCK_2' | 'BLOCK_3' = 'BLOCK_2') => ({
  block,
  code,
  label_en: code,
  label_bn: code,
  sort_order: 1,
});

function setup() {
  const versions: any[] = [];
  const criteria: any[] = [];
  let n = 0;
  const vRepo: any = {
    create: (v: any) => v,
    save: async (v: any) => {
      const row = { id: `v${++n}`, ...v };
      versions.push(row);
      return row;
    },
    findOne: async ({ where }: any) =>
      versions
        .filter((v) => v.tenant_id === where.tenant_id)
        .filter((v) => where.id === undefined || v.id === where.id)
        .sort((a, b) => b.version - a.version)[0] ?? null,
  };
  const cRepo: any = {
    create: (v: any) => v,
    save: async (rows: any[]) => {
      rows.forEach((r) => criteria.push({ id: `c${++n}`, ...r }));
      return rows;
    },
    find: async ({ where }: any) =>
      criteria.filter(
        (c) => c.tenant_id === where.tenant_id && c.form_version_id === where.form_version_id,
      ),
  };
  vRepo.manager = {
    transaction: async (cb: any) =>
      cb({ getRepository: (e: any) => (e.name === 'AcrFormVersion' ? vRepo : cRepo) }),
  };
  const audit = { record: vi.fn() };
  const svc = new AcrCriteriaService(vRepo, cRepo, audit as any);
  return { svc, versions, criteria, audit };
}

describe('AcrCriteriaService', () => {
  it('returns an empty set when no version exists', async () => {
    const { svc } = setup();
    expect(await svc.getLatest(A)).toEqual({ id: null, version: 0, criteria: [] });
  });

  it('edit creates version N+1 and leaves version N rows untouched; no 25 total enforced', async () => {
    const { svc, criteria, audit } = setup();
    const v1 = await svc.save({ criteria: [crit('a'), crit('b')] }, A, 'u1');
    const snapshot = JSON.stringify(criteria.filter((c) => c.form_version_id === v1.id));
    const v2 = await svc.save({ criteria: [crit('a')] }, A, 'u1');
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v2.criteria).toHaveLength(1);
    expect(JSON.stringify(criteria.filter((c) => c.form_version_id === v1.id))).toBe(snapshot);
    expect((await svc.getLatest(A)).id).toBe(v2.id);
    expect(audit.record).toHaveBeenCalledTimes(2);
  });

  it('isolates tenants', async () => {
    const { svc } = setup();
    await svc.save({ criteria: [crit('a')] }, A, 'u1');
    expect(await svc.getLatest(B)).toEqual({ id: null, version: 0, criteria: [] });
    expect((await svc.save({ criteria: [] }, B, 'u2')).version).toBe(1);
  });

  it('getByVersion: an older version still resolves its own criteria after a newer save', async () => {
    const { svc } = setup();
    const v1 = await svc.save({ criteria: [crit('a'), crit('b')] }, A, 'u1');
    const v2 = await svc.save({ criteria: [crit('c')] }, A, 'u1');
    const old = await svc.getByVersion(v1.id as string, A);
    expect(old.version).toBe(1);
    expect(old.criteria.map((c) => c.code).sort()).toEqual(['a', 'b']);
    expect((await svc.getByVersion(v2.id as string, A)).criteria.map((c) => c.code)).toEqual(['c']);
  });

  it('getByVersion: unknown or other-tenant version is 404', async () => {
    const { svc } = setup();
    const v1 = await svc.save({ criteria: [crit('a')] }, A, 'u1');
    await expect(svc.getByVersion(v1.id as string, B)).rejects.toThrow(/not found/);
    await expect(svc.getByVersion('nope', A)).rejects.toThrow(/not found/);
  });

  it('rejects duplicate codes within a block', async () => {
    const { svc } = setup();
    await expect(svc.save({ criteria: [crit('a'), crit('a')] }, A, 'u1')).rejects.toThrow(/unique/);
  });
});
