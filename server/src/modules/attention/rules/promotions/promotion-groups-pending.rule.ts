import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';

type Recipient = RuleFinding['recipients'][number];

/**
 * DRAFT promotion run entries that still have no group while their target class uses groups
 * (some target-class section carries a non-null group_name). One item per run + source section,
 * for that section's class / assistant class teachers and the admins (D6, D15).
 * Clears at 0, or when the run commits (no longer DRAFT).
 */
@AttentionRule()
export class PromotionGroupsPendingRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('promotion.groups_pending');
  readonly messages = {
    en: {
      title: '{sectionLabel}: {count} students without a group',
      why: 'Their next class has groups. Students without a group cannot be placed when the promotion is committed.',
      steps: ['Open the promotion.', 'Set a group for each student.', 'Then commit the promotion.'],
      action: 'Set groups',
    },
    bn: {
      title: '{sectionLabel}: {count} জন শিক্ষার্থীর গ্রুপ ঠিক করা হয়নি',
      why: 'তাদের পরের ক্লাসে গ্রুপ আছে। গ্রুপ ছাড়া প্রমোশন চূড়ান্ত করলে শিক্ষার্থীদের বসানো যাবে না।',
      steps: [
        'প্রমোশন পাতা খুলুন।',
        'প্রতিটি শিক্ষার্থীর গ্রুপ ঠিক করুন।',
        'তারপর প্রমোশন চূড়ান্ত করুন।',
      ],
      action: 'গ্রুপ ঠিক করুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const rows: { runId: string; sectionId: string; sectionLabel: string; count: number }[] =
      await this.dataSource.query(
        `SELECT r.id AS "runId", e.source_section_id AS "sectionId",
                c.name || '-' || cs.section_name AS "sectionLabel", COUNT(*)::int AS count
         FROM promotion_runs r
         JOIN promotion_entries e ON e.run_id = r.id AND e.tenant_id = $1
         JOIN class_sections cs ON cs.id = e.source_section_id AND cs.tenant_id = $1 AND cs.deleted_at IS NULL
         JOIN classes c ON c.id = cs.class_id AND c.tenant_id = $1 AND c.deleted_at IS NULL
         WHERE r.tenant_id = $1 AND r.status = 'DRAFT'
           AND e.group_name IS NULL AND COALESCE(e.target_class_id, r.target_class_id) IS NOT NULL
           AND EXISTS (SELECT 1 FROM class_sections t WHERE t.tenant_id = $1
             AND t.class_id = COALESCE(e.target_class_id, r.target_class_id) AND t.deleted_at IS NULL AND t.group_name IS NOT NULL)
         GROUP BY r.id, e.source_section_id, c.name, cs.section_name`,
        [ctx.tenantId],
      );
    if (!rows.length) return [];
    const [admins, teachers] = await Promise.all([
      this.admins(ctx.tenantId),
      this.homeroom(ctx.tenantId, [...new Set(rows.map((r) => r.sectionId))]),
    ]);
    return rows
      .map((r) => {
        const seen = new Set<string>();
        const recipients = [...(teachers.get(r.sectionId) ?? []), ...admins].filter(
          (x) => !seen.has(x.userId) && !!seen.add(x.userId),
        );
        return {
          dedupeKey: `promotion:${r.runId}:section:${r.sectionId}`,
          subject: { type: 'promotion_run', id: r.runId },
          params: { sectionId: r.sectionId, sectionLabel: r.sectionLabel, count: r.count },
          actionUrl: `/promotions/${r.runId}`,
          recipients,
        };
      })
      .filter((f) => f.recipients.length);
  }

  private async admins(tenantId: string): Promise<Recipient[]> {
    const rows: { userId: string }[] = await this.dataSource.query(
      `SELECT DISTINCT ut.user_id AS "userId"
       FROM user_tenants ut
       JOIN users u ON u.id = ut.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
       WHERE ut.tenant_id = $1 AND ut.deleted_at IS NULL AND ut.role::text = 'ADMIN'`,
      [tenantId],
    );
    return rows.map((r) => ({ userId: r.userId, role: UserRole.ADMIN }));
  }

  /**
   * Class / assistant class teachers of the given source sections. Unlike
   * loadHomeroomSections this is not limited to the current year: a run's source year is usually past.
   */
  private async homeroom(
    tenantId: string,
    sectionIds: string[],
  ): Promise<Map<string, Recipient[]>> {
    const rows: { sectionId: string; userId: string }[] = await this.dataSource.query(
      `SELECT DISTINCT tcs.section_id AS "sectionId", t.user_id AS "userId"
       FROM teacher_class_sections tcs
       JOIN teachers t ON t.id = tcs.teacher_id AND t.tenant_id = $1 AND t.deleted_at IS NULL
       JOIN users u ON u.id = t.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
       WHERE tcs.tenant_id = $1 AND tcs.section_id = ANY($2::uuid[])
         AND tcs.assignment_type IN ('CLASS_TEACHER', 'ASSISTANT_CLASS_TEACHER')`,
      [tenantId, sectionIds],
    );
    const out = new Map<string, Recipient[]>();
    for (const r of rows) {
      const list = out.get(r.sectionId) ?? [];
      list.push({ userId: r.userId, role: UserRole.TEACHER });
      out.set(r.sectionId, list);
    }
    return out;
  }
}
