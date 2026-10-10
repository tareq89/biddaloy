import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { FamilyAccessService } from '../../../students/family-access.service';
import { AttentionRule } from '../attention-rule.decorator';
import { endOfLocalDay } from '../rule-context.service';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { loadNotSubmitted, type NotSubmittedRow } from './homework-not-submitted.rule';

/** Rows grouped by student, keeping the first row for the labels. */
export function groupByStudent(rows: NotSubmittedRow[]) {
  const map = new Map<string, NotSubmittedRow[]>();
  for (const r of rows) map.set(r.studentId, [...(map.get(r.studentId) ?? []), r]);
  return map;
}

@AttentionRule()
export class HomeworkDueTodayRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('homework.due_today');
  readonly messages = {
    en: {
      title: 'You have {count} homework due today',
      why: "Hand each one in before that subject's class starts.",
      steps: ['Finish every homework.', 'Hand it in before the class starts.'],
    },
    bn: {
      title: 'আজ তোমার {count}টি বাড়ির কাজ জমা দিতে হবে',
      why: 'প্রতিটি কাজ সেই বিষয়ের ক্লাস শুরুর আগে জমা দাও।',
      steps: ['সব বাড়ির কাজ শেষ করো।', 'ক্লাস শুরুর আগে জমা দাও।'],
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly family: FamilyAccessService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const rows = await loadNotSubmitted(this.dataSource, ctx.tenantId, ctx.localDate);
    if (!rows.length) return [];
    const byStudent = groupByStudent(rows);
    // Students only: the guardians get the evening reminder (due_tomorrow).
    const users = (
      await this.family.familyUsersForStudents(ctx.tenantId, [...byStudent.keys()])
    ).filter((u) => u.role === UserRole.STUDENT);
    const expiresAt = endOfLocalDay(ctx.localDate, ctx.tz);
    const findings: RuleFinding[] = [];
    for (const [studentId, list] of byStudent) {
      const recipients = users
        .filter((u) => u.studentId === studentId)
        .map((u) => ({ userId: u.userId, role: u.role, studentId }));
      if (!recipients.length) continue;
      findings.push({
        dedupeKey: `student:${studentId}:${ctx.localDate}`,
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
