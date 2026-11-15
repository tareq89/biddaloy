import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta, ModuleKey } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { roleRecipients } from '../structure/role-recipients';

/**
 * [71.2.10, Epic 71 D24] A list's act-by date has passed, seats are still free and the next list
 * has not been opened. Lapsed OFFERED applicants count as free: opening the next list expires them
 * first. Next list = first unactivated list in merit-then-waiting order; its predecessor must be the
 * one whose deadline passed (the same rule `AdmissionListService.activate` enforces).
 */
@AttentionRule({ module: ModuleKey.admission })
export class AdmissionListDeadlineRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('admission.list_deadline');
  readonly messages = {
    en: {
      title: 'Merit list deadline is over, {seats} seats are free. Open waiting list {sequence}?',
      why: '"{title}": the offers of the last list have lapsed and seats are still free.',
      steps: ['Open the admission round.', 'Open the next waiting list.'],
      action: 'Open the round',
    },
    bn: {
      title: 'মেরিট তালিকার সময় শেষ, {seats}টা আসন ফাঁকা। অপেক্ষা-তালিকা {sequence} চালু করবেন?',
      why: '"{title}": আগের তালিকার প্রস্তাবের সময় শেষ, কিন্তু আসন ফাঁকা আছে।',
      steps: ['ভর্তির রাউন্ডটি খুলুন।', 'পরের অপেক্ষা-তালিকা চালু করুন।'],
      action: 'রাউন্ডটি খুলুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const rows: { id: string; title: string; sequence: number; vacant: number }[] =
      await this.dataSource.query(
        `WITH ord AS (
           SELECT l.id, l.intake_id, l.sequence, l.activated_at, l.act_by_date,
                  row_number() OVER (PARTITION BY l.intake_id
                                     ORDER BY (l.kind <> 'MERIT'), l.sequence) AS rn
             FROM admission_lists l
            WHERE l.tenant_id = $1 AND l.deleted_at IS NULL),
         nxt AS (
           SELECT DISTINCT ON (intake_id) * FROM ord
            WHERE activated_at IS NULL ORDER BY intake_id, rn)
         SELECT i.id, i.title, nxt.sequence,
                i.seat_count
                - (SELECT count(*)::int FROM admission_applicants a
                    WHERE a.tenant_id = $1 AND a.intake_id = i.id AND a.deleted_at IS NULL
                      AND a.status = 'ADMITTED')
                - (SELECT count(*)::int FROM admission_applicants a
                    WHERE a.tenant_id = $1 AND a.intake_id = i.id AND a.deleted_at IS NULL
                      AND a.status = 'OFFERED'
                      AND NOT EXISTS (
                        SELECT 1 FROM admission_list_members m
                          JOIN admission_lists l2 ON l2.id = m.list_id
                         WHERE m.applicant_id = a.id AND m.deleted_at IS NULL
                           AND l2.deleted_at IS NULL AND l2.activated_at IS NOT NULL
                           AND l2.act_by_date < $2::date)) AS vacant
           FROM admission_intakes i
           JOIN nxt ON nxt.intake_id = i.id
           JOIN ord p ON p.intake_id = i.id AND p.rn = nxt.rn - 1
          WHERE i.tenant_id = $1 AND i.deleted_at IS NULL
            AND p.activated_at IS NOT NULL AND p.act_by_date < $2::date
            AND EXISTS (SELECT 1 FROM admission_list_members m
                          JOIN admission_applicants a ON a.id = m.applicant_id
                         WHERE m.list_id = nxt.id AND m.deleted_at IS NULL
                           AND a.deleted_at IS NULL AND a.status = 'WAITING')`,
        [ctx.tenantId, ctx.localDate],
      );
    const open = rows.filter((r) => r.vacant > 0);
    if (!open.length) return [];
    const recipients = await roleRecipients(this.dataSource, ctx.tenantId, this.meta.roles);
    if (!recipients.length) return [];
    return open.map((r) => ({
      dedupeKey: `admission_list_deadline:${r.id}:${r.sequence}`,
      subject: { type: 'admission_intake', id: r.id },
      params: { title: r.title, seats: r.vacant, sequence: r.sequence },
      actionUrl: `/admissions/intakes/${r.id}`,
      recipients,
    }));
  }
}
