import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { FamilyAccessService } from '../../../students/family-access.service';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { childFindings } from './family-data';

const WINDOW_MS = 72 * 3600_000;

/** Results published in the last 72 h; the 72 h expiry closes them even without a later run. */
@AttentionRule()
export class ResultsPublishedRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('results.published');
  readonly messages = {
    en: {
      title: '{exam} results are out for {studentName}',
      why: 'The school has published the results.',
      steps: ['Open Results to see marks and grade.'],
      action: 'See results',
    },
    bn: {
      title: '{studentName}-এর {exam} পরীক্ষার ফলাফল প্রকাশিত হয়েছে',
      why: 'স্কুল ফলাফল প্রকাশ করেছে।',
      steps: ['নম্বর ও গ্রেড দেখতে ফলাফল পাতা খুলুন।'],
      action: 'ফলাফল দেখুন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly family: FamilyAccessService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const rows: { id: string; student_id: string; published_at: Date; exam: string }[] =
      await this.dataSource.query(
        `SELECT r.id, r.student_id, r.published_at, e.name AS exam
         FROM results r
         JOIN exams e ON e.id = r.exam_id AND e.tenant_id = $1 AND e.status = 'PUBLISHED' AND e.deleted_at IS NULL
         WHERE r.tenant_id = $1 AND r.deleted_at IS NULL AND r.published_at >= $2`,
        [ctx.tenantId, new Date(ctx.now.getTime() - WINDOW_MS)],
      );
    return childFindings(
      this.dataSource,
      this.family,
      ctx.tenantId,
      this.meta,
      rows.map((r) => ({
        studentId: r.student_id,
        dedupeKey: `result:${r.id}`,
        params: { exam: r.exam },
        expiresAt: new Date(r.published_at.getTime() + WINDOW_MS),
        actionUrl: `/portal/results?student=${r.student_id}`,
      })),
    );
  }
}
