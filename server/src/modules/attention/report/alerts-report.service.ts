import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ALERT_RULES, toCsvContent } from '@biddaloy/shared';
import { ATTENTION_RETENTION_MONTHS } from '../attention.constants';
import { RuleContextService, localDateTimeToUtc } from '../rules/rule-context.service';
import { AlertsReportDto, AlertsReportQueryDto } from './dto/alerts-report.dto';

const RULE_ORDER = new Map(ALERT_RULES.map((r, i) => [r.key as string, i]));
const META = new Map(ALERT_RULES.map((r) => [r.key as string, r]));

/** `YYYY-MM` shifted by `n` months. */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/**
 * [67.5.04] Monthly counts of RULE alerts from history, per rule x section. Reads `alerts`
 * only (no table of its own); manual alerts are not rule breaches and are excluded.
 *
 * Section convention: an alert's section is the reserved `params.sectionId` (and its
 * `params.sectionLabel`) that section- and student-scoped rules set (67.1.03). An alert with no
 * `sectionId` counts in the "no section" cell (`sectionId: null`). Rules that act on a section
 * but do not set `params.sectionId` therefore land there.
 */
@Injectable()
export class AlertsReportService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ruleContext: RuleContextService,
  ) {}

  async getReport(
    tenantId: string,
    q: Pick<AlertsReportQueryDto, 'month' | 'ruleKey' | 'sectionId'>,
  ): Promise<AlertsReportDto> {
    const ctx = await this.ruleContext.build(tenantId, new Date());
    const thisMonth = ctx.localDate.slice(0, 7);
    // D31: history is pruned after 12 months; the oldest month still on offer is 11 months back
    if (q.month > thisMonth || q.month < addMonths(thisMonth, 1 - ATTENTION_RETENTION_MONTHS))
      throw new BadRequestException(
        `month must be between ${addMonths(thisMonth, 1 - ATTENTION_RETENTION_MONTHS)} and ${thisMonth}`,
      );

    // school-local month bounds, as UTC instants
    const at = (ym: string) => localDateTimeToUtc(`${ym}-01`, '00:00', ctx.tz);
    const [prevStart, start, end] = [
      at(addMonths(q.month, -1)),
      at(q.month),
      at(addMonths(q.month, 1)),
    ];

    const filter = (extra: unknown[]) => {
      const where = [`tenant_id = $1`, `source = 'RULE'`, `raised_at >= $2`, `raised_at < $3`];
      const params: unknown[] = [tenantId, ...extra];
      if (q.ruleKey) where.push(`rule_key = $${params.push(q.ruleKey)}`);
      if (q.sectionId) where.push(`params->>'sectionId' = $${params.push(q.sectionId)}`);
      return { where: where.join(' AND '), params };
    };
    const cur = filter([start, end]);
    const prev = filter([prevStart, start]);

    const [counts, [facts], [previous]] = await Promise.all([
      this.dataSource.query(
        `SELECT rule_key, params->>'sectionId' AS section_id, MAX(params->>'sectionLabel') AS section_label,
                COUNT(*)::int AS n
           FROM alerts WHERE ${cur.where} GROUP BY 1, 2`,
        cur.params,
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS total,
                (COUNT(*) FILTER (WHERE status = 'RESOLVED'))::int AS resolved,
                ROUND(AVG(EXTRACT(EPOCH FROM resolved_at - raised_at) / 60)
                      FILTER (WHERE status = 'RESOLVED'))::int AS avg_resolve_minutes,
                (COUNT(*) FILTER (WHERE status = 'ACTIVE'))::int AS open,
                (COUNT(*) FILTER (WHERE status = 'ACTIVE' AND severity = 'CRITICAL'))::int AS open_critical
           FROM alerts WHERE ${cur.where}`,
        cur.params,
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS n FROM alerts WHERE ${prev.where}`,
        prev.params,
      ),
    ]);

    type Count = {
      rule_key: string;
      section_id: string | null;
      section_label: string | null;
      n: number;
    };
    const sections = new Map<string, string>();
    for (const c of counts as Count[])
      if (c.section_id) sections.set(c.section_id, c.section_label ?? c.section_id);
    const sectionList = [...sections]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));

    const byRule = new Map<string, Map<string | null, number>>();
    for (const c of counts as Count[]) {
      if (!byRule.has(c.rule_key)) byRule.set(c.rule_key, new Map());
      byRule.get(c.rule_key)!.set(c.section_id, c.n);
    }
    const rows = [...byRule]
      .sort(([a], [b]) => (RULE_ORDER.get(a) ?? 999) - (RULE_ORDER.get(b) ?? 999))
      .map(([ruleKey, cellMap]) => {
        const meta = META.get(ruleKey);
        const cells = [...sectionList.map((s) => s.id), null].map((sectionId) => ({
          sectionId,
          count: cellMap.get(sectionId) ?? 0,
        }));
        return {
          ruleKey,
          category: meta?.category as AlertsReportDto['rows'][number]['category'],
          severity: meta?.severity as AlertsReportDto['rows'][number]['severity'],
          cells,
          total: cells.reduce((sum, c) => sum + c.count, 0),
        };
      });

    return {
      month: q.month,
      facts: {
        total: facts.total,
        resolved: facts.resolved,
        avgResolveMinutes: facts.avg_resolve_minutes,
        open: facts.open,
        openCritical: facts.open_critical,
        previousMonthTotal: previous.n,
      },
      sections: sectionList,
      rows,
    };
  }

  /** Long format, one line per non-zero cell. `toCsvContent` adds the BOM and defuses formula cells. */
  toCsv(report: AlertsReportDto): string {
    const label = new Map(report.sections.map((s) => [s.id, s.label]));
    const lines: unknown[][] = [['Rule key', 'Category', 'Severity', 'Section', 'Count']];
    for (const r of report.rows)
      for (const c of r.cells)
        if (c.count > 0)
          lines.push([
            r.ruleKey,
            r.category,
            r.severity,
            c.sectionId ? (label.get(c.sectionId) ?? c.sectionId) : 'No section',
            c.count,
          ]);
    return toCsvContent(lines);
  }
}
