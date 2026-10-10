import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { ResolveRoutineService } from '../../../routines/resolve-routine.service';
import { AttentionRule } from '../attention-rule.decorator';
import { endOfLocalDay } from '../rule-context.service';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { roleRecipients } from '../structure/role-recipients';
import { earliest, loadDaySlots, loadTeachers } from './period-data';

@AttentionRule()
export class RoutineUncoveredPeriodsRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('routine.uncovered_periods');
  readonly messages = {
    en: {
      title: '{count} periods today have no teacher',
      why: 'Their teacher is on leave and nobody is covering. First one: {firstSection} at {firstAt}.',
      steps: [
        'Open Routines › Substitutions.',
        'Pick a substitute teacher for each period, or cancel it.',
      ],
      action: 'Arrange substitutes',
    },
    bn: {
      title: 'আজ {count}টি পিরিয়ডে কোনো শিক্ষক নেই',
      why: 'শিক্ষক ছুটিতে আছেন, কেউ বদলি নেননি। প্রথমটি: {firstSection}, {firstAt}-এ।',
      steps: [
        'রুটিন › বদলি খুলুন।',
        'প্রতিটি পিরিয়ডে বদলি শিক্ষক দিন, অথবা পিরিয়ডটি বাতিল করুন।',
      ],
      action: 'বদলি ঠিক করুন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly resolveRoutine: ResolveRoutineService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    if (!ctx.isWorkingDay) return [];
    // Still to come or running; not substituted; has teachers.
    const pending = (
      await loadDaySlots(this.dataSource, this.resolveRoutine, ctx.tenantId, ctx.localDate)
    ).filter((s) => !s.substituted && s.teacher_ids.length > 0 && s.endsAt > ctx.localTime);
    if (!pending.length) return [];

    const [teachers, leaves]: [
      Awaited<ReturnType<typeof loadTeachers>>,
      { staff_profile_id: string }[],
    ] = await Promise.all([
      loadTeachers(this.dataSource, ctx.tenantId, [
        ...new Set(pending.flatMap((s) => s.teacher_ids)),
      ]),
      this.dataSource.query(
        `SELECT staff_profile_id FROM leave_records
         WHERE tenant_id = $1 AND status = 'APPROVED' AND start_date <= $2 AND end_date >= $2`,
        [ctx.tenantId, ctx.localDate],
      ),
    ]);
    const onLeave = new Set(leaves.map((l) => l.staff_profile_id));
    const uncovered = pending.filter((s) =>
      s.teacher_ids.every((id) => {
        const profile = teachers.get(id)?.staffProfileId;
        return !!profile && onLeave.has(profile);
      }),
    );
    if (!uncovered.length) return [];

    const recipients = await roleRecipients(this.dataSource, ctx.tenantId, this.meta.roles);
    if (!recipients.length) return [];
    const first = earliest(uncovered);
    return [
      {
        dedupeKey: `school:${ctx.tenantId}:${ctx.localDate}`,
        params: {
          count: uncovered.length,
          firstSection: first.sectionLabel,
          firstAt: first.startsAt,
        },
        expiresAt: endOfLocalDay(ctx.localDate, ctx.tz),
        actionUrl: `/routines/substitutions?from=${ctx.localDate}&to=${ctx.localDate}`,
        recipients,
      },
    ];
  }
}
