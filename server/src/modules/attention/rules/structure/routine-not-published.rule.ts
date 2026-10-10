import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { roleRecipients } from './role-recipients';

const STATE_LABEL: Record<string, { en: string; bn: string }> = {
  none: { en: 'not started', bn: 'শুরু হয়নি' },
  DRAFT: { en: 'draft', bn: 'খসড়া' },
  REVIEW: { en: 'waiting for review', bn: 'পর্যালোচনার অপেক্ষায়' },
};

@AttentionRule()
export class RoutineNotPublishedRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('routine.not_published');
  readonly messages = {
    en: {
      title: 'The class routine for {year} is not published',
      why: "Routine status: {state_en}. Until it is published, teachers, students and parents see no timetable, and attendance and class reminders can't use it.",
      steps: [
        'Open Routines › Review.',
        'Fix anything flagged in the review.',
        'Publish the routine.',
      ],
      action: 'Review routine',
    },
    bn: {
      title: '{year} শিক্ষাবর্ষের ক্লাস রুটিন প্রকাশ করা হয়নি',
      why: 'রুটিনের অবস্থা: {state_bn}। প্রকাশ না করা পর্যন্ত শিক্ষক, শিক্ষার্থী ও অভিভাবকরা কোনো রুটিন দেখবেন না, হাজিরা ও ক্লাসের রিমাইন্ডারও কাজ করবে না।',
      steps: [
        'রুটিন › পর্যালোচনা খুলুন।',
        'পর্যালোচনায় যা ধরা পড়েছে তা ঠিক করুন।',
        'রুটিন প্রকাশ করুন।',
      ],
      action: 'রুটিন দেখুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const rows: { id: string; name: string; state: string | null }[] = await this.dataSource.query(
      `SELECT y.id, y.name, r.state::text AS state
       FROM academic_years y
       LEFT JOIN routines r ON r.academic_year_id = y.id AND r.tenant_id = $1 AND r.deleted_at IS NULL
       WHERE y.tenant_id = $1 AND y.is_current = true AND y.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM classes c WHERE c.tenant_id = $1 AND c.academic_year_id = y.id AND c.deleted_at IS NULL)`,
      [ctx.tenantId],
    );
    const open = rows.filter((r) => r.state !== 'PUBLISHED');
    if (!open.length) return [];
    const recipients = await roleRecipients(this.dataSource, ctx.tenantId, [UserRole.ADMIN]);
    if (!recipients.length) return [];
    return open.map((r) => {
      const label = STATE_LABEL[r.state ?? 'none'] ?? { en: r.state ?? '', bn: r.state ?? '' };
      return {
        dedupeKey: `academic_year:${r.id}`,
        subject: { type: 'academic_year', id: r.id },
        params: { year: r.name, state_en: label.en, state_bn: label.bn },
        actionUrl: '/routines/review',
        recipients,
      };
    });
  }
}
