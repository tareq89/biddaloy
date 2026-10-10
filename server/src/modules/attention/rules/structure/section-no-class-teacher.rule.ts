import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { roleRecipients } from './role-recipients';

@AttentionRule()
export class SectionNoClassTeacherRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('section.no_class_teacher');
  readonly messages = {
    en: {
      title: '{count} sections have no class teacher',
      why: 'No class teacher: {sections}. Nobody gets the attendance reminder for these sections.',
      steps: [
        'Open Staff › Teaching assignments.',
        'Pick the class.',
        'Assign a class teacher to each section.',
      ],
      action: 'Assign class teachers',
    },
    bn: {
      title: '{count}টি সেকশনে কোনো শ্রেণিশিক্ষক নেই',
      why: 'শ্রেণিশিক্ষক নেই: {sections}। এই সেকশনগুলোর হাজিরার রিমাইন্ডার কেউ পাবেন না।',
      steps: [
        'কর্মী › পাঠদান দায়িত্ব খুলুন।',
        'ক্লাস বেছে নিন।',
        'প্রতিটি সেকশনে একজন শ্রেণিশিক্ষক দিন।',
      ],
      action: 'শ্রেণিশিক্ষক নির্ধারণ করুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const rows: { id: string; label: string }[] = await this.dataSource.query(
      `SELECT cs.id, c.name || '-' || cs.section_name AS label
       FROM class_sections cs
       JOIN classes c ON c.id = cs.class_id AND c.tenant_id = $1 AND c.deleted_at IS NULL
       JOIN academic_years y ON y.id = c.academic_year_id AND y.tenant_id = $1 AND y.is_current = true AND y.deleted_at IS NULL
       WHERE cs.tenant_id = $1 AND cs.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM teacher_class_sections tcs
           JOIN teachers t ON t.id = tcs.teacher_id AND t.tenant_id = $1 AND t.deleted_at IS NULL
           WHERE tcs.tenant_id = $1 AND tcs.section_id = cs.id AND tcs.assignment_type = 'CLASS_TEACHER')
       ORDER BY c.numeric_grade NULLS LAST, c.name, cs.section_name`,
      [ctx.tenantId],
    );
    if (!rows.length) return [];
    const recipients = await roleRecipients(this.dataSource, ctx.tenantId, [UserRole.ADMIN]);
    if (!recipients.length) return [];
    const sections =
      rows
        .slice(0, 3)
        .map((r) => r.label)
        .join(', ') + (rows.length > 3 ? ' …' : '');
    return [
      {
        dedupeKey: `school:${ctx.tenantId}`,
        params: { count: rows.length, sections },
        actionUrl: '/staff/teaching-assignments',
        recipients,
      },
    ];
  }
}
