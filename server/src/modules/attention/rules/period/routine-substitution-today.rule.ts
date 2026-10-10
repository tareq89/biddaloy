import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { ResolveRoutineService } from '../../../routines/resolve-routine.service';
import { AttentionRule } from '../attention-rule.decorator';
import { endOfLocalDay } from '../rule-context.service';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { earliest, loadDaySlots, loadTeachers, type DaySlot } from './period-data';

@AttentionRule()
export class RoutineSubstitutionTodayRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('routine.substitution_today');
  readonly messages = {
    en: {
      title: 'You are covering {count} periods today',
      why: 'Your first cover is {firstSection} at {firstAt}. These periods are in your routine for today.',
      steps: ['Open your routine for today.', "Check each covered period's class and room."],
      action: 'Open my routine',
    },
    bn: {
      title: 'আজ আপনাকে {count}টি পিরিয়ড বদলি নিতে হবে',
      why: 'প্রথম বদলি ক্লাস {firstSection}, {firstAt}-এ। এই পিরিয়ডগুলো আজ আপনার রুটিনে আছে।',
      steps: ['আজকের রুটিন খুলুন।', 'প্রতিটি বদলি পিরিয়ডের ক্লাস ও রুম দেখে নিন।'],
      action: 'আমার রুটিন খুলুন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly resolveRoutine: ResolveRoutineService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const covered = (
      await loadDaySlots(this.dataSource, this.resolveRoutine, ctx.tenantId, ctx.localDate)
    ).filter((s) => s.substituted && s.substitute_teacher_id);
    if (!covered.length) return [];

    const bySubstitute = new Map<string, DaySlot[]>();
    for (const s of covered) {
      const id = s.substitute_teacher_id!;
      bySubstitute.set(id, [...(bySubstitute.get(id) ?? []), s]);
    }
    const teachers = await loadTeachers(this.dataSource, ctx.tenantId, [...bySubstitute.keys()]);
    const expiresAt = endOfLocalDay(ctx.localDate, ctx.tz);
    const findings: RuleFinding[] = [];
    for (const [teacherId, list] of bySubstitute) {
      const teacher = teachers.get(teacherId);
      if (!teacher) continue;
      const first = earliest(list);
      findings.push({
        dedupeKey: `teacher:${teacherId}:${ctx.localDate}`,
        subject: { type: 'teacher', id: teacherId },
        params: { count: list.length, firstSection: first.sectionLabel, firstAt: first.startsAt },
        expiresAt,
        actionUrl: '/routines/my',
        recipients: [{ userId: teacher.userId, role: UserRole.TEACHER }],
      });
    }
    return findings;
  }
}
