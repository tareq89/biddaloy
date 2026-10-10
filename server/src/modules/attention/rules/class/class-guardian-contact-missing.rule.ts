import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { loadHomeroomSections } from './class-homeroom';

@AttentionRule()
export class ClassGuardianContactMissingRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('class.guardian_contact_missing');
  readonly messages = {
    en: {
      title: '{sectionLabel}: {count} students have no guardian phone',
      why: "You can't reach these families, and they won't get absence SMS.",
      steps: [
        'Open My class › {sectionLabel}.',
        "Ask the students for a guardian's phone number.",
        'Give the numbers to the office to add.',
      ],
      action: 'Open my class',
    },
    bn: {
      title: '{sectionLabel}: {count} জন শিক্ষার্থীর অভিভাবকের ফোন নম্বর নেই',
      why: 'এই পরিবারগুলোর সাথে যোগাযোগ করা যাচ্ছে না, তারা অনুপস্থিতির এসএমএসও পাবে না।',
      steps: [
        'আমার ক্লাস › {sectionLabel} খুলুন।',
        'শিক্ষার্থীদের কাছ থেকে অভিভাবকের ফোন নম্বর নিন।',
        'নম্বরগুলো যোগ করার জন্য অফিসে দিন।',
      ],
      action: 'আমার ক্লাস খুলুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const sections = await loadHomeroomSections(this.dataSource, ctx.tenantId);
    if (sections.size === 0) return [];
    // Same "no phone" test as guardian.contact_missing (67.3.03).
    const rows: { sectionId: string; count: number }[] = await this.dataSource.query(
      `SELECT s.class_section_id AS "sectionId", COUNT(*)::int AS count
       FROM students s
       WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND s.enrollment_status = 'ACTIVE'
         AND s.class_section_id = ANY($2::uuid[])
         AND NOT EXISTS (
           SELECT 1 FROM student_guardians sg
           JOIN guardians g ON g.id = sg.guardian_id AND g.tenant_id = $1 AND g.deleted_at IS NULL
           WHERE sg.student_id = s.id
             AND (NULLIF(trim(g.phone), '') IS NOT NULL OR NULLIF(trim(g.alternate_phone), '') IS NOT NULL))
       GROUP BY s.class_section_id`,
      [ctx.tenantId, [...sections.keys()]],
    );
    return rows
      .filter((r) => r.count > 0 && sections.has(r.sectionId))
      .map((r) => {
        const sec = sections.get(r.sectionId)!;
        return {
          dedupeKey: 'section:' + r.sectionId,
          subject: { type: 'section', id: r.sectionId },
          params: { sectionId: r.sectionId, sectionLabel: sec.sectionLabel, count: r.count },
          actionUrl: '/my-class/' + r.sectionId,
          recipients: sec.recipients,
        };
      });
  }
}
