import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThan, Repository } from 'typeorm';
import { PushService } from '../push/push.service';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { Survey } from './entities/survey.entity';
import { SurveyQuestion } from './entities/survey-question.entity';
import { SurveyTarget } from './entities/survey-target.entity';
import {
  CreateSurveyDto,
  SurveyQuestionInputDto,
  SurveyTargetInputDto,
  UpdateSurveyDto,
} from './dto/survey.dto';

export interface SurveyDetail extends Survey {
  questions: SurveyQuestion[];
  targets: SurveyTarget[];
}

/**
 * [28.2.4] Survey lifecycle: DRAFT -> OPEN -> CLOSED. Every query is scoped by
 * `tenant_id`; a survey in another tenant is a 404, never a 403.
 */
@Injectable()
export class SurveysService {
  constructor(
    @InjectRepository(Survey) private readonly surveyRepo: Repository<Survey>,
    @InjectRepository(SurveyQuestion) private readonly questionRepo: Repository<SurveyQuestion>,
    @InjectRepository(SurveyTarget) private readonly targetRepo: Repository<SurveyTarget>,
    @InjectRepository(TeacherClassSection)
    private readonly tcsRepo: Repository<TeacherClassSection>,
    private readonly push: PushService,
  ) {}

  private readonly logger = new Logger(SurveysService.name);

  /**
   * [28.4 D12] Best-effort, text-free push to everyone who can answer: the
   * linked students' own accounts and guardians, narrowed by `respondent`.
   * Survey text is never sent, only a fixed title. Never throws.
   */
  private async notifyRespondents(
    surveyId: string,
    respondent: string,
    tenantId: string,
  ): Promise<void> {
    try {
      const rows: { user_id: string }[] = await this.surveyRepo.query(
        `SELECT DISTINCT uid AS user_id FROM (
           SELECT s.user_id AS uid
             FROM survey_targets st
             JOIN teacher_class_sections tcs ON tcs.tenant_id = st.tenant_id
              AND tcs.teacher_id = st.teacher_id AND tcs.subject_id = st.subject_id
             JOIN students s ON s.tenant_id = st.tenant_id AND s.class_section_id = tcs.section_id
              AND s.deleted_at IS NULL AND s.enrollment_status = 'ACTIVE'
            WHERE st.tenant_id = $1 AND st.survey_id = $2 AND $3 <> 'GUARDIANS'
           UNION
           SELECT g.user_id AS uid
             FROM survey_targets st
             JOIN teacher_class_sections tcs ON tcs.tenant_id = st.tenant_id
              AND tcs.teacher_id = st.teacher_id AND tcs.subject_id = st.subject_id
             JOIN students s ON s.tenant_id = st.tenant_id AND s.class_section_id = tcs.section_id
              AND s.deleted_at IS NULL AND s.enrollment_status = 'ACTIVE'
             JOIN student_guardians sg ON sg.student_id = s.id
             JOIN guardians g ON g.id = sg.guardian_id AND g.tenant_id = st.tenant_id
            WHERE st.tenant_id = $1 AND st.survey_id = $2 AND $3 <> 'STUDENTS'
         ) r WHERE uid IS NOT NULL`,
        [tenantId, surveyId, respondent],
      );
      await Promise.all(
        rows.map((r) =>
          this.push
            .sendToUser(r.user_id, tenantId, {
              type: 'survey.published',
              title: 'New teacher survey',
              body: 'New teacher survey',
              url: '/portal/surveys',
            })
            .catch((e) => this.logger.warn(`survey push failed: ${String(e)}`)),
        ),
      );
    } catch (e) {
      this.logger.warn(`survey notify failed for ${surveyId}: ${String(e)}`);
    }
  }

  /** Each (teacher, subject) must be a real assignment in this tenant. */
  private async assertTargetsValid(
    targets: SurveyTargetInputDto[],
    tenantId: string,
  ): Promise<void> {
    const seen = new Set<string>();
    for (const t of targets) {
      const key = `${t.teacherId}:${t.subjectId}`;
      if (seen.has(key)) throw new BadRequestException('Duplicate survey target');
      seen.add(key);
      const exists = await this.tcsRepo.findOne({
        where: { tenant_id: tenantId, teacher_id: t.teacherId, subject_id: t.subjectId },
        select: { id: true },
      });
      if (!exists) {
        throw new BadRequestException(
          `Teacher ${t.teacherId} is not assigned to subject ${t.subjectId}`,
        );
      }
    }
  }

  private assertWindow(opensAt?: Date | null, closesAt?: Date | null): void {
    if (opensAt && closesAt && closesAt <= opensAt) {
      throw new BadRequestException('closesAt must be after opensAt');
    }
  }

  private async writeChildren(
    manager: EntityManager,
    surveyId: string,
    tenantId: string,
    questions?: SurveyQuestionInputDto[],
    targets?: SurveyTargetInputDto[],
  ): Promise<void> {
    if (questions) {
      await manager.delete(SurveyQuestion, { survey_id: surveyId, tenant_id: tenantId });
      await manager.save(
        SurveyQuestion,
        questions.map((q, i) =>
          manager.create(SurveyQuestion, {
            tenant_id: tenantId,
            survey_id: surveyId,
            sort_order: i,
            text: q.text,
            stars_enabled: q.starsEnabled,
          }),
        ),
      );
    }
    if (targets) {
      await manager.delete(SurveyTarget, { survey_id: surveyId, tenant_id: tenantId });
      await manager.save(
        SurveyTarget,
        targets.map((t) =>
          manager.create(SurveyTarget, {
            tenant_id: tenantId,
            survey_id: surveyId,
            teacher_id: t.teacherId,
            subject_id: t.subjectId,
          }),
        ),
      );
    }
  }

  async create(dto: CreateSurveyDto, tenantId: string): Promise<SurveyDetail> {
    await this.assertTargetsValid(dto.targets, tenantId);
    const opensAt = dto.opensAt ? new Date(dto.opensAt) : null;
    const closesAt = dto.closesAt ? new Date(dto.closesAt) : null;
    this.assertWindow(opensAt, closesAt);

    const id = await this.surveyRepo.manager.transaction(async (manager) => {
      const survey = await manager.save(
        Survey,
        manager.create(Survey, {
          tenant_id: tenantId,
          title: dto.title,
          status: 'DRAFT',
          anonymous: dto.anonymous,
          respondent: dto.respondent,
          opens_at: opensAt,
          closes_at: closesAt,
          min_responses: dto.minResponses ?? 5,
        }),
      );
      await this.writeChildren(manager, survey.id, tenantId, dto.questions, dto.targets);
      return survey.id;
    });
    return this.findOne(id, tenantId);
  }

  /** Loads a survey (404 cross-tenant) and lazily closes it once past `closes_at`. */
  private async loadAndAutoClose(id: string, tenantId: string): Promise<Survey> {
    const survey = await this.surveyRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!survey) throw new NotFoundException('Survey not found');
    if (survey.status === 'OPEN' && survey.closes_at && survey.closes_at <= new Date()) {
      survey.status = 'CLOSED';
      await this.surveyRepo.save(survey);
    }
    return survey;
  }

  async findOne(id: string, tenantId: string): Promise<SurveyDetail> {
    const survey = await this.loadAndAutoClose(id, tenantId);
    const [questions, targets] = await Promise.all([
      this.questionRepo.find({
        where: { survey_id: id, tenant_id: tenantId },
        order: { sort_order: 'ASC' },
      }),
      this.targetRepo.find({ where: { survey_id: id, tenant_id: tenantId } }),
    ]);
    return Object.assign(survey, { questions, targets });
  }

  async findAll(tenantId: string): Promise<Survey[]> {
    // ponytail: lazy auto-close, no scheduler; a bulk UPDATE keeps lists honest.
    await this.surveyRepo.update(
      { tenant_id: tenantId, status: 'OPEN', closes_at: LessThan(new Date()) },
      { status: 'CLOSED' },
    );
    return this.surveyRepo.find({
      where: { tenant_id: tenantId },
      order: { created_at: 'DESC' },
    });
  }

  async update(id: string, dto: UpdateSurveyDto, tenantId: string): Promise<SurveyDetail> {
    const survey = await this.loadAndAutoClose(id, tenantId);
    if (survey.status !== 'DRAFT') {
      throw new BadRequestException('Only a DRAFT survey can be edited');
    }
    if (dto.targets) await this.assertTargetsValid(dto.targets, tenantId);
    const opensAt = dto.opensAt ? new Date(dto.opensAt) : survey.opens_at;
    const closesAt = dto.closesAt ? new Date(dto.closesAt) : survey.closes_at;
    this.assertWindow(opensAt, closesAt);

    await this.surveyRepo.manager.transaction(async (manager) => {
      const locked = await manager.findOne(Survey, {
        where: { id, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked || locked.status !== 'DRAFT') {
        throw new BadRequestException('Only a DRAFT survey can be edited');
      }
      Object.assign(survey, {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.anonymous !== undefined && { anonymous: dto.anonymous }),
        ...(dto.respondent !== undefined && { respondent: dto.respondent }),
        ...(dto.minResponses !== undefined && { min_responses: dto.minResponses }),
        opens_at: opensAt,
        closes_at: closesAt,
      });
      await manager.save(Survey, survey);
      await this.writeChildren(manager, id, tenantId, dto.questions, dto.targets);
    });
    return this.findOne(id, tenantId);
  }

  async publish(id: string, tenantId: string): Promise<SurveyDetail> {
    const survey = await this.loadAndAutoClose(id, tenantId);
    if (survey.status !== 'DRAFT') {
      throw new BadRequestException('Only a DRAFT survey can be published');
    }
    if (survey.closes_at && survey.closes_at <= new Date()) {
      throw new BadRequestException('closesAt is already in the past');
    }
    // Lock the row so a concurrent draft `update` can't swap content between
    // validation and OPEN; `update` takes the same lock.
    await this.surveyRepo.manager.transaction(async (manager) => {
      const locked = await manager.findOne(Survey, {
        where: { id, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked || locked.status !== 'DRAFT') {
        throw new BadRequestException('Only a DRAFT survey can be published');
      }
      const [q, t] = await Promise.all([
        manager.count(SurveyQuestion, { where: { survey_id: id, tenant_id: tenantId } }),
        manager.count(SurveyTarget, { where: { survey_id: id, tenant_id: tenantId } }),
      ]);
      if (q === 0 || t === 0) {
        throw new BadRequestException('A survey needs at least one question and one target');
      }
      locked.status = 'OPEN';
      await manager.save(Survey, locked);
    });
    // Fire-and-forget: a slow or failing push must never delay or fail publish.
    void this.notifyRespondents(id, survey.respondent, tenantId);
    return this.findOne(id, tenantId);
  }

  async close(id: string, tenantId: string): Promise<SurveyDetail> {
    const survey = await this.loadAndAutoClose(id, tenantId);
    if (survey.status !== 'OPEN') {
      throw new BadRequestException('Only an OPEN survey can be closed');
    }
    survey.status = 'CLOSED';
    await this.surveyRepo.save(survey);
    return this.findOne(id, tenantId);
  }
}
