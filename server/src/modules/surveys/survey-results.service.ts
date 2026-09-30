import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission, roleHasPermission } from '@biddaloy/shared';
import { Teacher } from '../academics/entities/teacher.entity';
import { Survey } from './entities/survey.entity';
import { SurveyQuestion } from './entities/survey-question.entity';
import { SurveyTarget } from './entities/survey-target.entity';
import { SurveyPairResult } from './dto/survey-respond.dto';

type PairKey = { teacher_id: string; subject_id: string };

/**
 * [28.4.2] Aggregated results. Privacy invariants (D10/D13/D14):
 * - no query here selects `respondent_user_id` or any timestamp, so no
 *   respondent identity or submission time can reach a payload;
 * - a pair below `min_responses` yields only {teacherId, subjectId, count, hidden};
 * - comments are sorted by text, never by insertion order.
 * A caller without ACR_READ, or who is a target teacher of the survey, gets 404
 * for the whole route.
 */
@Injectable()
export class SurveyResultsService {
  constructor(
    @InjectRepository(Survey) private readonly surveyRepo: Repository<Survey>,
    @InjectRepository(SurveyQuestion) private readonly questionRepo: Repository<SurveyQuestion>,
    @InjectRepository(SurveyTarget) private readonly targetRepo: Repository<SurveyTarget>,
    @InjectRepository(Teacher) private readonly teacherRepo: Repository<Teacher>,
  ) {}

  async getResults(surveyId: string, role: string, userId: string, tenantId: string) {
    if (!roleHasPermission(role, Permission.ACR_READ)) {
      throw new NotFoundException('Survey not found');
    }
    const survey = await this.surveyRepo.findOne({ where: { id: surveyId, tenant_id: tenantId } });
    if (!survey) throw new NotFoundException('Survey not found');

    const [targets, questions, self] = await Promise.all([
      this.targetRepo.find({ where: { survey_id: surveyId, tenant_id: tenantId } }),
      this.questionRepo.find({
        where: { survey_id: surveyId, tenant_id: tenantId },
        order: { sort_order: 'ASC' },
      }),
      this.teacherRepo.find({
        where: { user_id: userId, tenant_id: tenantId },
        select: { id: true },
      }),
    ]);
    const selfIds = new Set(self.map((t) => t.id));
    if (targets.some((t) => selfIds.has(t.teacher_id))) {
      throw new NotFoundException('Survey not found');
    }

    const [counts, stars, comments] = (await Promise.all([
      this.surveyRepo.query(
        `SELECT teacher_id, subject_id, COUNT(*)::int AS count FROM survey_responses
          WHERE tenant_id = $1 AND survey_id = $2 GROUP BY teacher_id, subject_id`,
        [tenantId, surveyId],
      ),
      this.surveyRepo.query(
        `SELECT r.teacher_id, r.subject_id, a.question_id, AVG(a.stars)::float AS avg,
                COUNT(*)::int AS n
           FROM survey_answers a
           JOIN survey_responses r ON r.id = a.response_id AND r.tenant_id = a.tenant_id
          WHERE a.tenant_id = $1 AND r.survey_id = $2
          GROUP BY r.teacher_id, r.subject_id, a.question_id`,
        [tenantId, surveyId],
      ),
      this.surveyRepo.query(
        `SELECT r.teacher_id, r.subject_id, a.question_id, a.text
           FROM survey_answers a
           JOIN survey_responses r ON r.id = a.response_id AND r.tenant_id = a.tenant_id
          WHERE a.tenant_id = $1 AND r.survey_id = $2 AND a.text IS NOT NULL AND a.text <> ''
          ORDER BY a.text ASC`,
        [tenantId, surveyId],
      ),
    ])) as [
      (PairKey & { count: number })[],
      (PairKey & { question_id: string; avg: number | null; n: number })[],
      (PairKey & { question_id: string; text: string })[],
    ];

    const pair = (r: PairKey) => `${r.teacher_id}:${r.subject_id}`;
    const countOf = new Map(counts.map((c) => [pair(c), c.count]));

    const results: SurveyPairResult[] = targets.map((t) => {
      const k = pair(t);
      const count = countOf.get(k) ?? 0;
      // Results stay sealed until the survey is CLOSED: peeking while open lets
      // an admin infer who answered from each new response.
      if (survey.status !== 'CLOSED' || count < survey.min_responses) {
        return { teacherId: t.teacher_id, subjectId: t.subject_id, count, hidden: true };
      }
      return {
        teacherId: t.teacher_id,
        subjectId: t.subject_id,
        count,
        hidden: false,
        questions: questions.map((q) => {
          const row = stars.find((s) => pair(s) === k && s.question_id === q.id);
          // Per-question gate: a question answered by fewer than min_responses
          // people (others skipped it) could identify those few respondents.
          if (!row || row.n < survey.min_responses) {
            return { questionId: q.id, text: q.text, averageStars: null, comments: [] };
          }
          return {
            questionId: q.id,
            text: q.text,
            averageStars: row.avg == null ? null : Math.round(row.avg * 100) / 100,
            comments: comments
              .filter((c) => pair(c) === k && c.question_id === q.id)
              .map((c) => c.text),
          };
        }),
      };
    });

    return {
      surveyId: survey.id,
      title: survey.title,
      anonymous: survey.anonymous,
      minResponses: survey.min_responses,
      results,
    };
  }
}
