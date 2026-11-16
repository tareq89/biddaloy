import { describe, it, expect, vi } from 'vitest';
import { AdmissionPublicationService } from './admission-publication.service';

const TENANT = 't1';
const actor = { userId: 'u1' };

type R = { id: string; status?: string };

/** Fake manager: flag rows, recipients, audit. `flip` = false means already published. */
function build(recipients: R[], opts: { published?: boolean; smsFails?: boolean } = {}) {
  const published = opts.published ?? false;
  const audits: Record<string, unknown>[] = [];
  const queries: string[] = [];
  const manager = {
    getRepository: () => ({ findOne: async () => ({ id: 'i1', title: 'Class One' }) }),
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes('AS published')) return [{ published }];
      if (sql.startsWith('UPDATE'))
        return [published ? [] : [{ at: '2026-01-01T00:00:00.000Z' }], published ? 0 : 1];
      if (sql.includes('AS at')) return [{ at: '2026-01-01T00:00:00.000Z' }];
      return recipients.map((r) => ({
        id: r.id,
        tenant_id: TENANT,
        applicant_name: `N${r.id}`,
        guardian_name: 'G',
        guardian_phone: '01711000000',
        status: r.status ?? 'PENDING',
      }));
    }),
  };
  const notify = vi.fn(async () => {
    if (opts.smsFails) throw new Error('boom');
  });
  const service = new AdmissionPublicationService(
    {
      manager,
      transaction: (fn: (m: unknown) => unknown) => fn(manager),
    } as never,
    { notifyResult: notify, localeFor: async () => 'en' } as never,
    {
      isMetered: async () => true,
      getBalance: async () => ({ available: 50, reserved: 0 }),
    } as never,
    { record: async (a: Record<string, unknown>) => void audits.push(a) } as never,
  );
  return { service, notify, audits, queries };
}

const dto = { what: 'MERIT', ref_id: 'l1', send_sms: true } as const;

describe('AdmissionPublicationService', () => {
  it('sends to the recipient query only: rejected and not-passed stay off by default', async () => {
    const { service, queries } = build([{ id: 'a' }]);
    await service.publish('i1', dto, TENANT, actor);
    const sql = queries.find((q) => q.includes('admission_list_members'))!;
    expect(sql).toContain("a.status <> 'FEE_PENDING'");
    expect(sql).toContain("($3 OR a.status <> 'REJECTED')");
  });

  it('publishes, texts every recipient once with its outcome, audits without PII', async () => {
    const { service, notify, audits } = build([{ id: 'a' }, { id: 'b' }]);
    const res = await service.publish('i1', dto, TENANT, actor);
    expect(res).toMatchObject({ already_published: false, sms_attempted: 2 });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a' }),
      'Class One',
      'SELECTED',
    );
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0])).not.toMatch(/01711|Na/);
  });

  it('an included rejected applicant gets the REJECTED outcome, not SELECTED', async () => {
    const { service, notify } = build([{ id: 'a', status: 'REJECTED' }]);
    await service.publish('i1', { ...dto, include_not_selected: true }, TENANT, actor);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a' }),
      'Class One',
      'REJECTED',
    );
  });

  it('the estimate equals what the publish sends', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: String(i) }));
    const a = build(rows);
    const est = await a.service.estimate('i1', 'MERIT', 'l1', false, TENANT);
    const b = build(rows);
    const res = await b.service.publish('i1', dto, TENANT, actor);
    expect(est.recipients).toBe(30);
    expect(est.recipients).toBe(res.sms_attempted);
    expect(b.notify).toHaveBeenCalledTimes(30);
    expect(est).toMatchObject({ metered: true, available: 50, already_published: false });
    expect(est.segments).toBeGreaterThanOrEqual(30);
  });

  it('a failed SMS never fails the publish', async () => {
    const { service } = build([{ id: 'a' }], { smsFails: true });
    await expect(service.publish('i1', dto, TENANT, actor)).resolves.toMatchObject({
      already_published: false,
    });
  });

  it('send_sms false publishes without texting', async () => {
    const { service, notify } = build([{ id: 'a' }]);
    const res = await service.publish('i1', { ...dto, send_sms: false }, TENANT, actor);
    expect(res.sms_attempted).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('publishing again sends nothing and writes no second audit row; estimate is 0', async () => {
    const { service, notify, audits } = build([{ id: 'a' }], { published: true });
    const res = await service.publish('i1', dto, TENANT, actor);
    expect(res).toMatchObject({ already_published: true, sms_attempted: 0 });
    expect(notify).not.toHaveBeenCalled();
    expect(audits).toHaveLength(0);
    expect((await service.estimate('i1', 'MERIT', 'l1', false, TENANT)).recipients).toBe(0);
  });
});
