import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PublicAdmissionSiteService } from './public-admission-site.service';

const TENANT = 't-1';
const applicant = {
  id: 'a-1',
  intake_id: 'i-1',
  applicant_name: 'Rahim',
  roll_number: 'R-1',
  guardian_phone: '01700000001',
  status: 'SHORTLISTED',
};

function build(queries: { sql: string; rows: unknown[] }[]) {
  const qb: any = {
    where: () => qb,
    andWhere: () => qb,
    orderBy: () => qb,
    addOrderBy: () => qb,
    getMany: async () => [applicant],
  };
  const dataSource = {
    query: vi.fn(async (sql: string) => queries.find((q) => sql.includes(q.sql))?.rows ?? []),
  };
  const svc = new PublicAdmissionSiteService(
    { liveForWrite: async () => ({ tenantId: TENANT, school: { slug: 's' } }) } as never,
    {} as never,
    {} as never,
    { forTenant: async () => ({}) } as never,
    dataSource as never,
    { findOne: async () => ({ title: 'Round' }) } as never,
    { createQueryBuilder: () => qb } as never,
  );
  return { svc, dataSource };
}

describe('PublicAdmissionSiteService.result', () => {
  it('shows only what the round published (the query is gated on the published flags)', async () => {
    const { svc, dataSource } = build([
      {
        sql: 'admission_stage_results',
        rows: [{ title: 'Written', kind: 'WRITTEN', passed: false }],
      },
      { sql: 'admission_list_members', rows: [{ kind: 'MERIT', sequence: 1, position: 3 }] },
    ]);
    const out = await svc.result('h.test', { roll_number: 'r-1', guardian_phone: '01700000001' });
    expect(out.stages).toEqual([{ title: 'Written', outcome: 'NOT_PASSED' }]);
    expect(out.lists).toEqual([{ kind: 'MERIT', sequence: 1, position: 3 }]);
    expect(out.status).toBe('SHORTLISTED');
    const sqls = dataSource.query.mock.calls.map((c) => c[0] as string).join(' ');
    expect(sqls).toContain(`s.config ? 'published_at'`);
    expect(sqls).toContain('l.published_at IS NOT NULL');
  });

  it('hides the staff decision until the round has published something for the applicant', async () => {
    const { svc } = build([]);
    const out = await svc.result('h.test', { roll_number: 'r-1', guardian_phone: '01700000001' });
    expect(out.status).toBe('PENDING');
  });

  it('a wrong phone is the same NotFound as a wrong roll', async () => {
    const { svc } = build([]);
    const err = await svc
      .result('h.test', { roll_number: 'R-1', guardian_phone: '01899999999' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.message).toBe('Not found');
  });
});
