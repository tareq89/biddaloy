import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { addDaysIso } from '../rule-context.service';
import { roleRecipients } from '../structure/role-recipients';

@AttentionRule()
export class AdmissionIntakeWindowRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('admission.intake_window');
  readonly messages = {
    en: {
      title: 'Admission "{title}" opens or closes soon',
      why: 'It runs from {openDate} to {closeDate}. Make sure the notice and seats are right.',
      steps: ['Open the intake.', 'Check the dates and seat count.'],
      action: 'Open intake',
    },
    bn: {
      title: 'ভর্তি "{title}" শিগগির শুরু বা শেষ হচ্ছে',
      why: 'এটি চলবে {openDate} থেকে {closeDate} পর্যন্ত। বিজ্ঞপ্তি ও আসনসংখ্যা ঠিক আছে কি না দেখে নিন।',
      steps: ['ভর্তির পাতাটি খুলুন।', 'তারিখ ও আসনসংখ্যা মিলিয়ে দেখুন।'],
      action: 'ভর্তির পাতা খুলুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const rows: { id: string; title: string; open_date: string; close_date: string }[] =
      await this.dataSource.query(
        `SELECT id, title, to_char(open_date, 'YYYY-MM-DD') AS open_date,
                to_char(close_date, 'YYYY-MM-DD') AS close_date
         FROM admission_intakes
         WHERE tenant_id = $1 AND deleted_at IS NULL
           AND (open_date BETWEEN $2 AND $3 OR close_date BETWEEN $2 AND $3)`,
        [ctx.tenantId, ctx.localDate, addDaysIso(ctx.localDate, 3)],
      );
    if (!rows.length) return [];
    const recipients = await roleRecipients(this.dataSource, ctx.tenantId, this.meta.roles);
    if (!recipients.length) return [];
    return rows.map((r) => ({
      dedupeKey: `admission_intake:${r.id}`,
      subject: { type: 'admission_intake', id: r.id },
      params: { title: r.title, openDate: r.open_date, closeDate: r.close_date },
      actionUrl: `/admissions/intakes/${r.id}`,
      recipients,
    }));
  }
}
