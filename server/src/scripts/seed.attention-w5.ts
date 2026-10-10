import type { DataSource } from 'typeorm';
import { alertRuleMeta, type AlertRuleKey } from '@biddaloy/shared';
import { resolveTenantSettings } from '../modules/schools/settings/tenant-settings-resolver';

// Like seed.attention-rules.ts: must not import anything that reaches AppModule.

export const W5_MANUAL_DEDUPE = 'seed:manual:1';
export const W5_MANUAL_TITLE = 'Classes start at 9:00 tomorrow';
export const W5_HISTORY_COUNT = 40;
const HISTORY_RULES: AlertRuleKey[] = [
  'attendance.not_taken',
  'homework.not_submitted',
  'fees.due_soon',
  'homework.due_tomorrow',
];

/**
 * [67.5.10] Wave 5 demo rows for the default school: one sent manual alert to
 * every TEACHER, and 40 alerts in the previous local month for the alerts
 * report (3/4 RESOLVED, the rest EXPIRED, spread over up to 3 sections via
 * `params.sectionId`). Idempotent: each row is found by its `dedupe_key` first.
 */
export async function ensureAttentionW5Seed(
  ds: DataSource,
  tenantId: string,
  adminUserId: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = <R = Record<string, any>>(sql: string, params: unknown[] = []): Promise<R[]> =>
    ds.query(sql, params);
  const [school] = await q<{ settings: Record<string, unknown> | null }>(
    `SELECT settings FROM schools WHERE id = $1`,
    [tenantId],
  );
  if (!school) return;
  const tz = resolveTenantSettings(school.settings).region?.timezone ?? 'Asia/Dhaka';

  // --- one manual alert + one OPEN recipient per TEACHER ---------------------
  let [manual] = await q<{ id: string }>(
    `SELECT id FROM alerts WHERE tenant_id = $1 AND rule_key = 'manual.alert' AND dedupe_key = $2`,
    [tenantId, W5_MANUAL_DEDUPE],
  );
  if (!manual) {
    // ponytail: expires 7x24h from now, not local end-of-day; fine for a demo row
    // raised 25 h ago so it does not count toward the 24 h send cap (D27)
    [manual] = await q<{ id: string }>(
      `INSERT INTO alerts (tenant_id, rule_key, source, severity, category, status, dedupe_key,
                           params, raised_at, expires_at, created_by_user_id, manual_title,
                           manual_body, manual_audience)
       VALUES ($1, 'manual.alert', 'MANUAL', 'WARNING', 'MANUAL', 'ACTIVE', $2, '{}',
               now() - interval '25 hours', now() + interval '7 days', $3, $4, $5, $6) RETURNING id`,
      [
        tenantId,
        W5_MANUAL_DEDUPE,
        adminUserId,
        W5_MANUAL_TITLE,
        'Please be in your classroom by 8:50.',
        JSON.stringify({ roles: ['TEACHER'] }),
      ],
    );
  }
  await q(
    `INSERT INTO alert_recipients (tenant_id, alert_id, user_id, role, state)
     SELECT $1, $2, ut.user_id, NULL, 'OPEN'
       FROM user_tenants ut
      WHERE ut.tenant_id = $1 AND ut.role = 'TEACHER' AND ut.deleted_at IS NULL
     ON CONFLICT DO NOTHING`,
    [tenantId, manual!.id],
  );

  // --- last month's history ---------------------------------------------------
  const sections = await q<{ id: string; label: string }>(
    `SELECT cs.id, c.name || '-' || cs.section_name AS label
       FROM class_sections cs JOIN classes c ON c.id = cs.class_id AND c.tenant_id = cs.tenant_id
      WHERE cs.tenant_id = $1 AND cs.deleted_at IS NULL
      ORDER BY c.name, cs.section_name LIMIT 3`,
    [tenantId],
  );
  if (sections.length === 0) {
    console.warn('  Attention W5 seed: no class sections - skipping history');
    return;
  }
  // First instant of the previous school-local month.
  const [{ start }] = await q<{ start: Date }>(
    `SELECT (date_trunc('month', now() AT TIME ZONE $1) - interval '1 month') AT TIME ZONE $1 AS start`,
    [tz],
  );
  for (let n = 0; n < W5_HISTORY_COUNT; n++) {
    const dedupe = `seed:history:${n}`;
    const key = HISTORY_RULES[n % 4]!;
    const [exists] = await q(
      `SELECT 1 FROM alerts WHERE tenant_id = $1 AND rule_key = $2 AND dedupe_key = $3`,
      [tenantId, key, dedupe],
    );
    if (exists) continue;
    const meta = alertRuleMeta(key);
    const section = sections[n % sections.length]!;
    const resolved = n % 4 !== 3; // 3/4 RESOLVED (30 of 40)
    const raisedAt = new Date(start.getTime() + ((n % 27) * 24 + 9) * 3_600_000);
    await q(
      `INSERT INTO alerts (tenant_id, rule_key, source, severity, category, status, dedupe_key,
                           params, raised_at, last_evaluated_at, resolved_at, expires_at)
       VALUES ($1, $2, 'RULE', $3, $4, $5, $6, $7, $8, $8, $9, $10)`,
      [
        tenantId,
        key,
        key === 'attendance.not_taken' && n % 8 === 0 ? 'CRITICAL' : meta.severity,
        meta.category,
        resolved ? 'RESOLVED' : 'EXPIRED',
        dedupe,
        JSON.stringify({ sectionId: section.id, sectionLabel: section.label }),
        raisedAt,
        resolved ? new Date(raisedAt.getTime() + (10 + ((n * 7) % 81)) * 60_000) : null,
        resolved ? null : new Date(raisedAt.getTime() + 86_400_000),
      ],
    );
  }
}
