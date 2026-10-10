import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { AlertsReportService, addMonths } from './alerts-report.service';

const RULE = 'attendance.not_taken';
const S7B = '00000000-0000-4000-8000-0000007b0001';
const S8A = '00000000-0000-4000-8000-0000008a0001';

describe('AlertsReportService (integration)', () => {
  let ds: DataSource;
  let service: AlertsReportService;
  let tenantB: string;

  /** "now" for the report: 10 Oct 2026 in Dhaka (UTC+6, no DST). */
  const ruleContext = { build: async () => ({ tz: 'Asia/Dhaka', localDate: '2026-10-10' }) };

  const add = (
    raisedAt: string,
    o: {
      rule?: string;
      section?: string | null;
      label?: string;
      status?: string;
      severity?: string;
      resolvedAt?: string;
      source?: string;
      tenant?: string;
    } = {},
  ) =>
    ds.query(
      `INSERT INTO alerts (tenant_id, rule_key, source, severity, category, status, dedupe_key, params, raised_at, resolved_at)
       VALUES ($1, $2, $3, $4, 'ATTENDANCE', $5, gen_random_uuid()::text, $6::jsonb, $7, $8)`,
      [
        o.tenant ?? SEED_TENANT_ID,
        o.rule ?? RULE,
        o.source ?? 'RULE',
        o.severity ?? 'WARNING',
        o.status ?? 'ACTIVE',
        JSON.stringify(o.section ? { sectionId: o.section, sectionLabel: o.label } : {}),
        raisedAt,
        o.resolvedAt ?? null,
      ],
    );

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      AlertsReportService,
      {
        provide: (await import('../rules/rule-context.service')).RuleContextService,
        useValue: ruleContext,
      },
    ]);
    ds = module.get(DataSource);
    service = module.get(AlertsReportService);
    [{ id: tenantB }] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ('Report Other', 'report-other-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
    );
  }, 60000);

  afterAll(async () => {
    await ds.query(`DELETE FROM alerts WHERE tenant_id IN ($1, $2)`, [SEED_TENANT_ID, tenantB]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [tenantB]);
    await ds.destroy();
  });

  beforeEach(async () => {
    await ds.query(`DELETE FROM alerts WHERE tenant_id IN ($1, $2)`, [SEED_TENANT_ID, tenantB]);
  });

  it('pivots rule x section: 3 in 7-B, 1 in 8-A, 1 with no section', async () => {
    for (let i = 1; i <= 3; i++)
      await add(`2026-10-0${i}T05:00:00Z`, { section: S7B, label: '7-B' });
    await add('2026-10-04T05:00:00Z', { section: S8A, label: '8-A' });
    await add('2026-10-05T05:00:00Z');
    const r = await service.getReport(SEED_TENANT_ID, { month: '2026-10' });

    expect(r.sections).toEqual([
      { id: S7B, label: '7-B' },
      { id: S8A, label: '8-A' },
    ]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ ruleKey: RULE, category: 'ATTENDANCE', total: 5 });
    // one cell per section, then "no section" (null)
    expect(r.rows[0].cells).toEqual([
      { sectionId: S7B, count: 3 },
      { sectionId: S8A, count: 1 },
      { sectionId: null, count: 1 },
    ]);
  });

  it('uses the school-local month: 23:30 local on 30 Sep is September, local midnight is October', async () => {
    await add('2026-09-30T17:30:00Z'); // 23:30 in Dhaka, 30 Sep
    await add('2026-09-30T18:00:00Z'); // 00:00 in Dhaka, 1 Oct
    const oct = await service.getReport(SEED_TENANT_ID, { month: '2026-10' });
    const sep = await service.getReport(SEED_TENANT_ID, { month: '2026-09' });
    expect(oct.facts.total).toBe(1);
    expect(sep.facts.total).toBe(1);
    expect(oct.facts.previousMonthTotal).toBe(1);
  });

  it('facts: resolved, average minutes to resolve, open, open critical, previous month', async () => {
    await add('2026-10-01T05:00:00Z', { status: 'RESOLVED', resolvedAt: '2026-10-01T05:20:00Z' });
    await add('2026-10-02T05:00:00Z', { status: 'RESOLVED', resolvedAt: '2026-10-02T06:00:00Z' });
    await add('2026-10-03T05:00:00Z', { severity: 'CRITICAL' });
    await add('2026-10-04T05:00:00Z');
    await add('2026-10-05T05:00:00Z', { status: 'EXPIRED' });
    await add('2026-09-05T05:00:00Z');
    const { facts } = await service.getReport(SEED_TENANT_ID, { month: '2026-10' });
    expect(facts).toEqual({
      total: 5,
      resolved: 2,
      avgResolveMinutes: 40,
      open: 2,
      openCritical: 1,
      previousMonthTotal: 1,
    });
    // nothing resolved -> null, not 0
    await ds.query(`UPDATE alerts SET status = 'EXPIRED' WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    expect(
      (await service.getReport(SEED_TENANT_ID, { month: '2026-10' })).facts.avgResolveMinutes,
    ).toBeNull();
  });

  it('ruleKey and sectionId filters apply to counts, facts and the previous month', async () => {
    await add('2026-10-01T05:00:00Z', { section: S7B, label: '7-B' });
    await add('2026-10-01T05:00:00Z', { section: S8A, label: '8-A' });
    await add('2026-10-01T05:00:00Z', { rule: 'class.starting' });
    await add('2026-09-01T05:00:00Z', { section: S7B, label: '7-B' });
    const byRule = await service.getReport(SEED_TENANT_ID, { month: '2026-10', ruleKey: RULE });
    expect(byRule.rows.map((r) => r.ruleKey)).toEqual([RULE]);
    expect(byRule.facts.total).toBe(2);
    const bySection = await service.getReport(SEED_TENANT_ID, { month: '2026-10', sectionId: S7B });
    expect(bySection.facts).toMatchObject({ total: 1, previousMonthTotal: 1 });
    expect(bySection.sections).toEqual([{ id: S7B, label: '7-B' }]);
  });

  it('excludes MANUAL alerts and never counts another school', async () => {
    await add('2026-10-01T05:00:00Z', { source: 'MANUAL', rule: 'manual.alert' });
    await add('2026-10-01T05:00:00Z', { tenant: tenantB });
    const mine = await service.getReport(SEED_TENANT_ID, { month: '2026-10' });
    expect(mine.facts.total).toBe(0);
    expect(mine.rows).toEqual([]);
    expect((await service.getReport(tenantB, { month: '2026-10' })).facts.total).toBe(1);
  });

  it('only the last 12 months, and not the future', async () => {
    await expect(service.getReport(SEED_TENANT_ID, { month: '2025-10' })).rejects.toThrow(
      'month must be',
    );
    await expect(service.getReport(SEED_TENANT_ID, { month: '2026-11' })).rejects.toThrow(
      'month must be',
    );
    await expect(service.getReport(SEED_TENANT_ID, { month: '2025-11' })).resolves.toBeDefined();
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });

  it('CSV: header + one line per non-zero cell, with the BOM', async () => {
    await add('2026-10-01T05:00:00Z', { section: S7B, label: '7-B' });
    await add('2026-10-02T05:00:00Z');
    const csv = service.toCsv(await service.getReport(SEED_TENANT_ID, { month: '2026-10' }));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split('\r\n')).toEqual([
      '"Rule key","Category","Severity","Section","Count"',
      `"${RULE}","ATTENDANCE","REMINDER","7-B","1"`,
      `"${RULE}","ATTENDANCE","REMINDER","No section","1"`,
    ]);
  });
});
