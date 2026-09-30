import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThan, Repository } from 'typeorm';
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
  ) {}

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
    const [q, t] = await Promise.all([
      this.questionRepo.count({ where: { survey_id: id, tenant_id: tenantId } }),
      this.targetRepo.count({ where: { survey_id: id, tenant_id: tenantId } }),
    ]);
    if (q === 0 || t === 0) {
      throw new BadRequestException('A survey needs at least one question and one target');
    }
    survey.status = 'OPEN';
    await this.surveyRepo.save(survey);
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
