import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta, UserRole, ModuleKey } from '@biddaloy/shared';
import { ModuleStateReader } from '../../../auth/guards/module-state.reader';
import { isModuleOnForSchool } from '../../../schools/settings/school-modules.util';
import { ResolveRoutineService } from '../../../routines/resolve-routine.service';
import { AttentionRule } from '../attention-rule.decorator';
import { localDateTimeToUtc } from '../rule-context.service';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { loadNotSubmitted } from '../homework/homework-not-submitted.rule';
import { loadDaySlots, loadTeachers, toMinutes } from './period-data';

@AttentionRule({ module: ModuleKey.routines })
export class ClassStartingRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('class.starting');
  readonly messages = {
    en: {
      title: '{subject_en} in {sectionLabel} starts at {startsAt}',
      why: 'Your next class.{homework_en}',
      steps: ['Open your routine for today.', '{checkHomework_en}'],
      action: 'Open my routine',
    },
    bn: {
      title: '{sectionLabel}-এ {subject_bn} ক্লাস শুরু {startsAt}-এ',
      why: 'আপনার পরের ক্লাস।{homework_bn}',
      steps: ['আজকের রুটিন খুলুন।', '{checkHomework_bn}'],
      action: 'আমার রুটিন খুলুন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly resolveRoutine: ResolveRoutineService,
    private readonly moduleState: ModuleStateReader,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    if (!ctx.isWorkingDay) return [];
    const lead = ctx.settings.classStartingLeadMinutes;
    const now = toMinutes(ctx.localTime);
    const open = (
      await loadDaySlots(this.dataSource, this.resolveRoutine, ctx.tenantId, ctx.localDate)
    ).filter((s) => toMinutes(s.startsAt) - lead <= now && now < toMinutes(s.endsAt));
    if (!open.length) return [];

    // [77.2.10] Homework off: its routes answer 403, so the alert drops the homework text.
    const homeworkOn = await isModuleOnForSchool(this.moduleState, ctx.tenantId, ModuleKey.homework);
    const [teachers, notSubmitted] = await Promise.all([
      loadTeachers(this.dataSource, ctx.tenantId, [...new Set(open.flatMap((s) => s.teacher_ids))]),
      homeworkOn ? loadNotSubmitted(this.dataSource, ctx.tenantId, ctx.localDate) : [],
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
      const owedNow = owed.get(`${s.section_id}|${s.subject_id}`) ?? 0;
      findings.push({
        dedupeKey: `routine_slot:${s.routine_slot_id}:${ctx.localDate}`,
        subject: { type: 'section', id: s.section_id },
        params: {
          sectionId: s.section_id,
          sectionLabel: s.sectionLabel,
          subject_en: subjectEn,
          subject_bn: s.subject_name_bn ?? subjectEn,
          startsAt: s.startsAt,
          notSubmitted: owedNow,
          homework_en: homeworkOn
            ? ` Students who still have not submitted today's ${subjectEn} homework: ${owedNow}.`
            : '',
          homework_bn: homeworkOn
            ? ` আজকের ${s.subject_name_bn ?? subjectEn} বাড়ির কাজ এখনো জমা দেয়নি: ${owedNow} জন।`
            : '',
          checkHomework_en: homeworkOn ? 'Check homework before the class starts.' : '',
          checkHomework_bn: homeworkOn ? 'ক্লাস শুরুর আগে বাড়ির কাজ দেখে নিন।' : '',
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
