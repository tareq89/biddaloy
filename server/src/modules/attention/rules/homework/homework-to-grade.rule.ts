import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { loadSubjectTeachers } from './homework-not-submitted.rule';

@AttentionRule()
export class HomeworkToGradeRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('homework.to_grade');
  readonly messages = {
    en: {
      title: '{sectionLabel} {subject_en}: {count} submissions to check',
      why: 'Students handed in homework that is not checked yet.',
      steps: [
        'Open the homework list for {sectionLabel}.',
        'Mark each submission done, partial, or give marks.',
      ],
      action: 'Check homework',
    },
    bn: {
      title: '{sectionLabel} {subject_bn}: {count}টি জমা দেওয়া কাজ দেখা বাকি',
      why: 'শিক্ষার্থীরা বাড়ির কাজ জমা দিয়েছে, এখনো দেখা হয়নি।',
      steps: [
        '{sectionLabel}-এর বাড়ির কাজের তালিকা খুলুন।',
        'প্রতিটি কাজকে সম্পন্ন, আংশিক বা নম্বর দিয়ে চিহ্নিত করুন।',
      ],
      action: 'বাড়ির কাজ দেখুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const groups: {
      sectionId: string;
      subjectId: string;
      subject_en: string;
      subject_bn: string;
      count: number;
    }[] = await this.dataSource.query(
      `SELECT COALESCE(ha.section_id, s.class_section_id) AS "sectionId", h.subject_id AS "subjectId",
              MIN(sub.name_en) AS subject_en, MIN(COALESCE(sub.name_bn, sub.name_en)) AS subject_bn, COUNT(*)::int AS count
       FROM homework_submissions hs
       JOIN homework_assignments ha ON ha.id = hs.assignment_id AND ha.tenant_id = $1 AND ha.status = 'ACTIVE'
       JOIN homework h ON h.id = ha.homework_id AND h.tenant_id = $1
       JOIN subjects sub ON sub.id = h.subject_id AND sub.tenant_id = $1
       JOIN students s ON s.id = hs.student_id AND s.tenant_id = $1 AND s.deleted_at IS NULL
       WHERE hs.tenant_id = $1 AND hs.status = 'SUBMITTED'
       GROUP BY 1, 2`,
      [ctx.tenantId],
    );
    if (!groups.length) return [];
    const sectionIds = [...new Set(groups.map((g) => g.sectionId))];
    const [teachers, labels]: [Map<string, string[]>, { id: string; label: string }[]] =
      await Promise.all([
        loadSubjectTeachers(this.dataSource, ctx.tenantId, sectionIds),
        this.dataSource.query(
          `SELECT cs.id, c.name || '-' || cs.section_name AS label
           FROM class_sections cs
           JOIN classes c ON c.id = cs.class_id AND c.tenant_id = $1
           WHERE cs.tenant_id = $1 AND cs.id = ANY($2::uuid[])`,
          [ctx.tenantId, sectionIds],
        ),
      ]);
    const labelOf = new Map(labels.map((l) => [l.id, l.label]));
    const findings: RuleFinding[] = [];
    for (const g of groups) {
      const userIds = teachers.get(`${g.sectionId}|${g.subjectId}`);
      if (!userIds?.length) continue;
      findings.push({
        // Not per day: it clears when the work is checked.
        dedupeKey: `section:${g.sectionId}:${g.subjectId}`,
        subject: { type: 'section', id: g.sectionId },
        params: {
          sectionId: g.sectionId,
          sectionLabel: labelOf.get(g.sectionId) ?? '',
          subject_en: g.subject_en,
          subject_bn: g.subject_bn,
          count: g.count,
        },
        actionUrl: `/academics/homework?section_id=${g.sectionId}&subject_id=${g.subjectId}`,
        recipients: userIds.map((userId) => ({ userId, role: UserRole.TEACHER })),
      });
    }
    return findings;
  }
}
