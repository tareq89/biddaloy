import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { FamilyAccessService } from '../students/family-access.service';
import { Survey, SurveyRespondent } from './entities/survey.entity';
import { SurveyQuestion } from './entities/survey-question.entity';
import { SurveyResponse } from './entities/survey-response.entity';
import { SurveyAnswer } from './entities/survey-answer.entity';
import { RespondSurveyDto } from './dto/survey-respond.dto';

export interface PendingSurvey {
  id: string;
  title: string;
  anonymous: boolean;
  closesAt: Date | null;
  questions: { id: string; text: string; starsEnabled: boolean }[];
  pending: { teacherId: string; subjectId: string }[];
}

type PairRow = { survey_id: string; teacher_id: string; subject_id: string };

const PG_UNIQUE_VIOLATION = '23505';

/**
 * [28.4.2] Family side of teacher-evaluation surveys. Eligibility (D11): the
 * caller is (or guards) a student in a section where the target teacher
 * teaches that exact subject, and the pair is a `survey_targets` row. Every
 * query is scoped by `tenant_id`. Duplicates are stopped by the DB unique
 * index (mapped to 409), never by a pre-check.
 */
@Injectable()
export class SurveyRespondService {
  constructor(
    @InjectRepository(Survey) private readonly surveyRepo: Repository<Survey>,
    @InjectRepository(SurveyQuestion) private readonly questionRepo: Repository<SurveyQuestion>,
    private readonly familyAccess: FamilyAccessService,
  ) {}

  private roleAllowed(respondent: SurveyRespondent, role: string): boolean {
    if (role !== UserRole.STUDENT && role !== UserRole.PARENT) return false;
    if (respondent === 'BOTH') return true;
    return respondent === (role === UserRole.STUDENT ? 'STUDENTS' : 'GUARDIANS');
  }

  private inWindow(s: Survey, now: Date): boolean {
    return (!s.opens_at || s.opens_at <= now) && (!s.closes_at || s.closes_at > now);
  }

  /** Target pairs (per survey) the caller may answer: linked student + exact-subject teaching row. */
  private async eligiblePairs(
    surveyIds: string[],
    role: string,
    userId: string,
    tenantId: string,
  ): Promise<PairRow[]> {
    if (surveyIds.length === 0) return [];
    const studentIds = await this.familyAccess.getLinkedStudentIds(role, userId, tenantId);
    if (studentIds.length === 0) return [];
    return this.surveyRepo.query(
      `SELECT DISTINCT st.survey_id, st.teacher_id, st.subject_id
         FROM survey_targets st
         JOIN teacher_class_sections tcs
           ON tcs.tenant_id = st.tenant_id
          AND tcs.teacher_id = st.teacher_id
          AND tcs.subject_id = st.subject_id
         JOIN teachers t
           ON t.id = st.teacher_id
          AND t.tenant_id = st.tenant_id
          AND t.deleted_at IS NULL
         JOIN students s
           ON s.tenant_id = st.tenant_id
          AND s.class_section_id = tcs.section_id
          AND s.deleted_at IS NULL
          AND s.enrollment_status = 'ACTIVE'
          AND s.id = ANY($3::uuid[])
        WHERE st.tenant_id = $1 AND st.survey_id = ANY($2::uuid[])`,
      [tenantId, surveyIds, studentIds],
    );
  }

  async listMine(role: string, userId: string, tenantId: string): Promise<PendingSurvey[]> {
    const now = new Date();
    const open = (
      await this.surveyRepo.find({ where: { tenant_id: tenantId, status: 'OPEN' } })
    ).filter((s) => this.inWindow(s, now) && this.roleAllowed(s.respondent, role));
    const ids = open.map((s) => s.id);
    if (ids.length === 0) return [];

    const [eligible, done, questions] = await Promise.all([
      this.eligiblePairs(ids, role, userId, tenantId),
      this.surveyRepo.query(
        `SELECT survey_id, teacher_id, subject_id FROM survey_responses
          WHERE tenant_id = $1 AND respondent_user_id = $2 AND survey_id = ANY($3::uuid[])`,
        [tenantId, userId, ids],
      ) as Promise<PairRow[]>,
      this.questionRepo.find({
        where: ids.map((survey_id) => ({ survey_id, tenant_id: tenantId })),
        order: { sort_order: 'ASC' },
      }),
    ]);
    const key = (r: PairRow) => `${r.survey_id}:${r.teacher_id}:${r.subject_id}`;
    const answered = new Set(done.map(key));

    return open
      .map((s) => ({
        id: s.id,
        title: s.title,
        anonymous: s.anonymous,
        closesAt: s.closes_at,
        questions: questions
          .filter((q) => q.survey_id === s.id)
          .map((q) => ({ id: q.id, text: q.text, starsEnabled: q.stars_enabled })),
        pending: eligible
          .filter((e) => e.survey_id === s.id && !answered.has(key(e)))
          .map((e) => ({ teacherId: e.teacher_id, subjectId: e.subject_id })),
      }))
      .filter((s) => s.pending.length > 0);
  }

  async respond(
    surveyId: string,
    dto: RespondSurveyDto,
    role: string,
    userId: string,
    tenantId: string,
  ): Promise<{ teacherId: string; subjectId: string; submitted: true }> {
    const survey = await this.surveyRepo.findOne({ where: { id: surveyId, tenant_id: tenantId } });
    if (!survey) throw new NotFoundException('Survey not found');
    if (!this.roleAllowed(survey.respondent, role)) {
      throw new ForbiddenException('This survey is not open to your account type');
    }
    if (survey.status !== 'OPEN' || !this.inWindow(survey, new Date())) {
      throw new ConflictException('Survey is not open for responses');
    }

    const eligible = await this.eligiblePairs([surveyId], role, userId, tenantId);
    if (!eligible.some((e) => e.teacher_id === dto.teacherId && e.subject_id === dto.subjectId)) {
      throw new ForbiddenException('You are not eligible to rate this teacher and subject');
    }

    const questions = await this.questionRepo.find({
      where: { survey_id: surveyId, tenant_id: tenantId },
    });
    const byId = new Map(questions.map((q) => [q.id, q]));
    const seen = new Set<string>();
    for (const a of dto.answers) {
      const q = byId.get(a.questionId);
      if (!q) throw new BadRequestException(`Unknown question ${a.questionId}`);
      if (seen.has(a.questionId)) throw new BadRequestException('Duplicate answer for a question');
      seen.add(a.questionId);
      if (a.stars != null && !q.stars_enabled) {
        throw new BadRequestException('Stars are not enabled for this question');
      }
      if (a.stars == null && !a.text?.trim()) {
        throw new BadRequestException('Each answer needs stars or text');
      }
    }

    try {
      await this.surveyRepo.manager.transaction(async (manager) => {
        const response = await manager.save(
          SurveyResponse,
          manager.create(SurveyResponse, {
            tenant_id: tenantId,
            survey_id: surveyId,
            respondent_user_id: userId,
            teacher_id: dto.teacherId,
            subject_id: dto.subjectId,
          }),
        );
        await manager.save(
          SurveyAnswer,
          dto.answers.map((a) =>
            manager.create(SurveyAnswer, {
              tenant_id: tenantId,
              response_id: response.id,
              question_id: a.questionId,
              text: a.text?.trim() || null,
              stars: a.stars ?? null,
            }),
          ),
        );
      });
    } catch (e) {
      const err = e as { code?: string; driverError?: { code?: string } };
      if ((err.code ?? err.driverError?.code) === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('You have already responded for this teacher and subject');
      }
      throw e;
    }
    return { teacherId: dto.teacherId, subjectId: dto.subjectId, submitted: true };
  }
}
