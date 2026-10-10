import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { roleRecipients } from '../structure/role-recipients';

@AttentionRule()
export class StudentsRecordsIncompleteRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('students.records_incomplete');
  readonly messages = {
    en: {
      title: '{count} student records are incomplete',
      why: 'They are missing a photo, birth registration number or date of birth — certificates and ID cards need them.',
      steps: ['Open Students.', 'Open each incomplete record.', 'Add the missing details.'],
      action: 'Open students',
    },
    bn: {
      title: '{count} জন শিক্ষার্থীর তথ্য অসম্পূর্ণ',
      why: 'ছবি, জন্মনিবন্ধন নম্বর বা জন্মতারিখ নেই — সনদ ও পরিচয়পত্রে এগুলো লাগে।',
      steps: [
        'শিক্ষার্থী তালিকা খুলুন।',
        'অসম্পূর্ণ প্রতিটি তথ্য খুলুন।',
        'বাদ পড়া তথ্য যোগ করুন।',
      ],
      action: 'শিক্ষার্থী তালিকা খুলুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const [row]: { n: number }[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS n FROM students
       WHERE tenant_id = $1 AND deleted_at IS NULL AND enrollment_status = 'ACTIVE'
         AND (photo_key IS NULL OR NULLIF(trim(birth_reg_no), '') IS NULL OR date_of_birth IS NULL)`,
      [ctx.tenantId],
    );
    if (!row || row.n <= 0) return [];
    const recipients = await roleRecipients(this.dataSource, ctx.tenantId, this.meta.roles);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: `school:${ctx.tenantId}`,
        params: { count: row.n },
        actionUrl: '/students',
        recipients,
      },
    ];
  }
}
