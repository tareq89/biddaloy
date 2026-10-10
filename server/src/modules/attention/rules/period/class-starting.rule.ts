import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { ResolveRoutineService } from '../../../routines/resolve-routine.service';
import { AttentionRule } from '../attention-rule.decorator';
import { localDateTimeToUtc } from '../rule-context.service';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { loadNotSubmitted } from '../homework/homework-not-submitted.rule';
import { loadDaySlots, loadTeachers, toMinutes } from './period-data';

@AttentionRule()
export class ClassStartingRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('class.starting');
  readonly messages = {
    en: {
      title: '{subject_en} in {sectionLabel} starts at {startsAt}',
      why: "Your next class. Students who still have not submitted today's {subject_en} homework: {notSubmitted}.",
      steps: ['Open your routine for today.', 'Check homework before the class starts.'],
      action: 'Open my routine',
    },
    bn: {
      title: '{sectionLabel}-এ {subject_bn} ক্লাস শুরু {startsAt}-এ',
      why: 'আপনার পরের ক্লাস। আজকের {subject_bn} বাড়ির কাজ এখনো জমা দেয়নি: {notSubmitted} জন।',
      steps: ['আজকের রুটিন খুলুন।', 'ক্লাস শুরুর আগে বাড়ির কাজ দেখে নিন।'],
      action: 'আমার রুটিন খুলুন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly resolveRoutine: ResolveRoutineService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    if (!ctx.isWorkingDay) return [];
    const lead = ctx.settings.classStartingLeadMinutes;
    const now = toMinutes(ctx.localTime);
    const open = (
      await loadDaySlots(this.dataSource, this.resolveRoutine, ctx.tenantId, ctx.localDate)
    ).filter((s) => toMinutes(s.startsAt) - lead <= now && now < toMinutes(s.endsAt));
    if (!open.length) return [];

    const [teachers, notSubmitted] = await Promise.all([
      loadTeachers(this.dataSource, ctx.tenantId, [...new Set(open.flatMap((s) => s.teacher_ids))]),
      loadNotSubmitted(this.dataSource, ctx.tenantId, ctx.localDate),
    ]);
    const owed = new Map<string, number>();
    for (const r of notSubmitted) {
      const key = `${r.sectionId}|${r.subjectId}`;
      owed.set(key, (owed.get(key) ?? 0) + 1);
    }

    const findings: RuleFinding[] = [];
    for (const s of open) {
      const recipients = s.teacher_ids
        .map((id) => teachers.get(id))
        .filter((t) => !!t)
        .map((t) => ({ userId: t!.userId, role: UserRole.TEACHER }));
      if (!recipients.length) continue;
      const subjectEn = s.subject_name_en ?? '';
      findings.push({
        dedupeKey: `routine_slot:${s.routine_slot_id}:${ctx.localDate}`,
        subject: { type: 'section', id: s.section_id },
        params: {
          sectionId: s.section_id,
          sectionLabel: s.sectionLabel,
          subject_en: subjectEn,
          subject_bn: s.subject_name_bn ?? subjectEn,
          startsAt: s.startsAt,
          notSubmitted: owed.get(`${s.section_id}|${s.subject_id}`) ?? 0,
        },
        // D19: a short reminder, gone when the period ends.
        expiresAt: localDateTimeToUtc(ctx.localDate, s.endsAt, ctx.tz),
        actionUrl: '/routines/my',
        recipients,
      });
    }
    return findings;
  }
}
