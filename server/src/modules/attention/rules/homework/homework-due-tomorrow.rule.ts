import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { FamilyAccessService } from '../../../students/family-access.service';
import { AttentionRule } from '../attention-rule.decorator';
import { addDaysIso, localDateTimeToUtc } from '../rule-context.service';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { loadNotSubmitted } from './homework-not-submitted.rule';
import { groupByStudent } from './homework-due-today.rule';

/** Runs at `eveningAt`: `EVENING_RULE_KEYS` decides that, no time gate here. */
@AttentionRule()
export class HomeworkDueTomorrowRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('homework.due_tomorrow');
  readonly messages = {
    en: {
      title: '{studentName}: {count} homework due tomorrow',
      why: 'Finish it this evening so it is ready before class tomorrow.',
      steps: ["Check tomorrow's homework list.", 'Finish it and pack it tonight.'],
    },
    bn: {
      title: '{studentName}: আগামীকাল {count}টি বাড়ির কাজ জমা দিতে হবে',
      why: 'আজ সন্ধ্যায় শেষ করে রাখুন, যাতে কাল ক্লাসের আগে তৈরি থাকে।',
      steps: ['কালকের বাড়ির কাজের তালিকা দেখুন।', 'আজ রাতেই শেষ করে ব্যাগে রাখুন।'],
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly family: FamilyAccessService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const tomorrow = addDaysIso(ctx.localDate, 1);
    const rows = await loadNotSubmitted(this.dataSource, ctx.tenantId, tomorrow);
    if (!rows.length) return [];
    const byStudent = groupByStudent(rows);
    const users = await this.family.familyUsersForStudents(ctx.tenantId, [...byStudent.keys()]);
    // The reminder is for this evening: gone at local midnight.
    const expiresAt = localDateTimeToUtc(tomorrow, '00:00', ctx.tz);
    const findings: RuleFinding[] = [];
    for (const [studentId, list] of byStudent) {
      const recipients = users
        .filter((u) => u.studentId === studentId)
        .map((u) => ({ userId: u.userId, role: u.role, studentId }));
      if (!recipients.length) continue;
      findings.push({
        dedupeKey: `student:${studentId}:${tomorrow}`,
        subject: { type: 'student', id: studentId },
        params: {
          studentId,
          studentName: list[0].studentName,
          sectionId: list[0].sectionId,
          sectionLabel: list[0].sectionLabel,
          count: list.length,
        },
        expiresAt,
        recipients,
      });
    }
    return findings;
  }
}
