import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { FamilyAccessService } from '../../../students/family-access.service';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';

/** Copy of `SurveyRespondService.roleAllowed` (private there). */
function roleAllowed(respondent: string, role: string): boolean {
  if (role !== UserRole.STUDENT && role !== UserRole.PARENT) return false;
  if (respondent === 'BOTH') return true;
  return respondent === (role === UserRole.STUDENT ? 'STUDENTS' : 'GUARDIANS');
}

@AttentionRule()
export class SurveysPendingRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('surveys.pending');
  readonly messages = {
    en: {
      title: 'Please answer the survey "{title}"',
      why: '{count} teacher ratings are still waiting for your answer. It takes a minute.',
      steps: ['Open Surveys.', 'Rate each teacher and press Submit.'],
      action: 'Answer survey',
    },
    bn: {
      title: 'অনুগ্রহ করে "{title}" জরিপে উত্তর দিন',
      why: '{count}টি শিক্ষক মূল্যায়ন এখনো আপনার উত্তরের অপেক্ষায়। এক মিনিটেই হয়ে যাবে।',
      steps: ['জরিপ পাতা খুলুন।', 'প্রতিটি শিক্ষককে মূল্যায়ন করে জমা দিন।'],
      action: 'জরিপে উত্তর দিন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly family: FamilyAccessService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const surveys: { id: string; title: string; respondent: string; closes_at: Date | null }[] =
      await this.dataSource.query(
        `SELECT id, title, respondent, closes_at FROM surveys
         WHERE tenant_id = $1 AND status = 'OPEN'
           AND (opens_at IS NULL OR opens_at <= $2) AND (closes_at IS NULL OR closes_at > $2)`,
        [ctx.tenantId, ctx.now],
      );
    if (!surveys.length) return [];
    const ids = surveys.map((s) => s.id);

    // The `eligiblePairs` SQL of SurveyRespondService, minus the caller filter.
    const eligible: {
      survey_id: string;
      teacher_id: string;
      subject_id: string;
      student_id: string;
    }[] = await this.dataSource.query(
      `SELECT DISTINCT st.survey_id, st.teacher_id, st.subject_id, s.id AS student_id
         FROM survey_targets st
         JOIN teacher_class_sections tcs ON tcs.tenant_id = st.tenant_id AND tcs.teacher_id = st.teacher_id AND tcs.subject_id = st.subject_id
         JOIN teachers t ON t.id = st.teacher_id AND t.tenant_id = st.tenant_id AND t.deleted_at IS NULL
         JOIN students s ON s.tenant_id = st.tenant_id AND s.class_section_id = tcs.section_id AND s.deleted_at IS NULL AND s.enrollment_status = 'ACTIVE'
         WHERE st.tenant_id = $1 AND st.survey_id = ANY($2::uuid[])`,
      [ctx.tenantId, ids],
    );
    if (!eligible.length) return [];

    const users = await this.family.familyUsersForStudents(ctx.tenantId, [
      ...new Set(eligible.map((e) => e.student_id)),
    ]);
    const done: {
      survey_id: string;
      respondent_user_id: string;
      teacher_id: string;
      subject_id: string;
    }[] = await this.dataSource.query(
      `SELECT survey_id, respondent_user_id, teacher_id, subject_id FROM survey_responses
         WHERE tenant_id = $1 AND survey_id = ANY($2::uuid[])`,
      [ctx.tenantId, ids],
    );
    const answered = new Set(
      done.map((d) => `${d.survey_id}:${d.respondent_user_id}:${d.teacher_id}:${d.subject_id}`),
    );

    const usersOfStudent = new Map<string, typeof users>();
    for (const u of users)
      usersOfStudent.set(u.studentId, [...(usersOfStudent.get(u.studentId) ?? []), u]);
    const surveyById = new Map(surveys.map((s) => [s.id, s]));

    // (survey, user) -> distinct unanswered (teacher, subject) pairs, whichever child they came through.
    const pending = new Map<
      string,
      { surveyId: string; userId: string; role: UserRole; pairs: Set<string> }
    >();
    for (const e of eligible) {
      const survey = surveyById.get(e.survey_id)!;
      for (const u of usersOfStudent.get(e.student_id) ?? []) {
        if (!roleAllowed(survey.respondent, u.role)) continue;
        const pair = `${e.teacher_id}:${e.subject_id}`;
        if (answered.has(`${e.survey_id}:${u.userId}:${pair}`)) continue;
        const k = `${e.survey_id}:${u.userId}`;
        const entry = pending.get(k) ?? {
          surveyId: e.survey_id,
          userId: u.userId,
          role: u.role,
          pairs: new Set(),
        };
        entry.pairs.add(pair);
        pending.set(k, entry);
      }
    }
    return [...pending.values()].map(({ surveyId, userId, role, pairs }) => {
      const survey = surveyById.get(surveyId)!;
      return {
        dedupeKey: `survey:${surveyId}:user:${userId}`,
        subject: { type: 'survey', id: surveyId },
        // One item per person (like the portal card), so no studentId.
        params: { title: survey.title, count: pairs.size },
        actionUrl: '/portal/surveys',
        expiresAt: survey.closes_at ?? undefined,
        recipients: [{ userId, role }],
      };
    });
  }
}
