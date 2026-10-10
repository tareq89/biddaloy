import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta, AlertSeverity, UserRole } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { addDaysIso } from '../rule-context.service';
import {
  daysBetween,
  loadOutstandingGrids,
  type OutstandingGrid,
} from './exams-marks-overdue.rule';

const CRITICAL_DAYS = 7;

@AttentionRule()
export class ExamsMyMarksDueRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('exams.my_marks_due');
  readonly messages = {
    en: {
      title: 'Submit your marks: {exam} ({className})',
      why: '{count} of your mark sheets are not submitted, and the exam ended {days} days ago.',
      steps: ['Open Marks.', 'Enter the remaining marks.', 'Press Submit for each sheet.'],
      action: 'Enter marks',
    },
    bn: {
      title: 'নম্বর জমা দিন: {exam} ({className})',
      why: 'আপনার {count}টি নম্বরপত্র জমা হয়নি, অথচ পরীক্ষা শেষ হয়েছে {days} দিন আগে।',
      steps: ['নম্বর পাতা খুলুন।', 'বাকি নম্বরগুলো দিন।', 'প্রতিটি নম্বরপত্র জমা দিন।'],
      action: 'নম্বর দিন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const rows = await loadOutstandingGrids(
      this.dataSource,
      ctx.tenantId,
      addDaysIso(ctx.localDate, -1),
    );
    if (!rows.length) return [];
    // Write rule of MarksAuthorizationService.assertCanWrite: SUBJECT_TEACHER row of a live subject.
    const teachers: { sectionId: string; subjectId: string; userId: string }[] =
      await this.dataSource.query(
        `SELECT tcs.section_id AS "sectionId", tcs.subject_id AS "subjectId", t.user_id AS "userId"
         FROM teacher_class_sections tcs
         JOIN teachers t ON t.id = tcs.teacher_id AND t.tenant_id = $1 AND t.deleted_at IS NULL
         JOIN users u ON u.id = t.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
         JOIN subjects s ON s.id = tcs.subject_id AND s.tenant_id = $1 AND s.deleted_at IS NULL
         WHERE tcs.tenant_id = $1 AND tcs.assignment_type = 'SUBJECT_TEACHER' AND tcs.section_id = ANY($2::uuid[])`,
        [ctx.tenantId, [...new Set(rows.map((r) => r.sectionId))]],
      );
    const teachersOf = new Map<string, string[]>();
    for (const t of teachers) {
      const k = `${t.sectionId}:${t.subjectId}`;
      teachersOf.set(k, [...(teachersOf.get(k) ?? []), t.userId]);
    }
    const groups = new Map<string, { userId: string; grids: OutstandingGrid[] }>();
    for (const g of rows) {
      for (const userId of new Set(teachersOf.get(`${g.sectionId}:${g.subjectId}`) ?? [])) {
        const k = `${userId}:${g.examId}`;
        const grp = groups.get(k) ?? { userId, grids: [] };
        grp.grids.push(g);
        groups.set(k, grp);
      }
    }
    return [...groups.values()].map(({ userId, grids }) => {
      const first = grids[0];
      const days = daysBetween(first.lastDate, ctx.localDate);
      const oneSection = grids.every((g) => g.sectionId === first.sectionId);
      return {
        dedupeKey: `exam:${first.examId}:teacher:${userId}`,
        subject: { type: 'exam', id: first.examId },
        params: {
          exam: first.examName,
          className: first.className,
          count: grids.length,
          days,
          ...(oneSection ? { sectionId: first.sectionId, sectionLabel: first.sectionLabel } : {}),
        },
        actionUrl:
          grids.length === 1
            ? `/marks/${first.examId}/${first.sectionId}/${first.subjectId}`
            : '/marks',
        severity: days >= CRITICAL_DAYS ? AlertSeverity.CRITICAL : AlertSeverity.WARNING,
        recipients: [{ userId, role: UserRole.TEACHER }],
      };
    });
  }
}
