import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Not, Repository } from 'typeorm';
import { AuditAction, STAFF_ROLES } from '@biddaloy/shared';
import { AcrAssessment, AcrAssessmentStatus } from './entities/acr-assessment.entity';
import { AcrCriterion } from './entities/acr-criterion.entity';
import { AcrFormVersion } from './entities/acr-form-version.entity';
import { AcrScore } from './entities/acr-score.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AuditService } from '../audit/audit.service';
import {
  AcrAssessmentResponseDto,
  StartAcrAssessmentDto,
  UpdateAcrAssessmentDto,
} from './dto/assessment.dto';

const VALID_SCORES = [4, 3, 2, 1];

/**
 * ACR assessments. PRIVACY: the subject (assessment.user_id === caller) gets a
 * 404 on every read/write and is filtered out of lists in the query itself (D2).
 * Total is always the server-side sum of scores (D4). 28.2.2.
 */
@Injectable()
export class AcrAssessmentsService {
  constructor(
    @InjectRepository(AcrAssessment) private readonly assessments: Repository<AcrAssessment>,
    @InjectRepository(AcrScore) private readonly scores: Repository<AcrScore>,
    @InjectRepository(AcrCriterion) private readonly criteria: Repository<AcrCriterion>,
    @InjectRepository(AcrFormVersion) private readonly versions: Repository<AcrFormVersion>,
    @InjectRepository(UserTenant) private readonly userTenants: Repository<UserTenant>,
    @InjectRepository(AcademicYear) private readonly years: Repository<AcademicYear>,
    private readonly auditService: AuditService,
  ) {}

  async start(
    dto: StartAcrAssessmentDto,
    tenantId: string,
    callerId: string,
  ): Promise<AcrAssessmentResponseDto> {
    // Subject can't start their own ACR either; same 404 as every other route.
    if (dto.user_id === callerId) throw new NotFoundException('ACR assessment not found');
    if (
      !(await this.userTenants.findOne({
        where: { user_id: dto.user_id, tenant_id: tenantId, role: In([...STAFF_ROLES]) },
      }))
    )
      throw new BadRequestException('User is not a staff member of this school');
    if (!(await this.years.findOne({ where: { id: dto.academic_year_id, tenant_id: tenantId } })))
      throw new BadRequestException('Academic year not found');
    const latest = await this.versions.findOne({
      where: { tenant_id: tenantId },
      order: { version: 'DESC' },
    });
    if (!latest) throw new ConflictException('No ACR form version exists; save criteria first');
    const dup = await this.assessments.findOne({
      where: { tenant_id: tenantId, user_id: dto.user_id, academic_year_id: dto.academic_year_id },
    });
    if (dup) throw new ConflictException('An ACR already exists for this user and year');
    let row: AcrAssessment;
    try {
      row = await this.assessments.save(
        this.assessments.create({
          tenant_id: tenantId,
          user_id: dto.user_id,
          academic_year_id: dto.academic_year_id,
          form_version_id: latest.id,
          status: 'INCOMPLETE',
          total: null,
          assessed_by: callerId,
        }),
      );
    } catch (err) {
      if ((err as { code?: unknown })?.code === '23505')
        throw new ConflictException('An ACR already exists for this user and year');
      throw err;
    }
    return this.toResponse(row, tenantId);
  }

  async update(
    id: string,
    dto: UpdateAcrAssessmentDto,
    tenantId: string,
    callerId: string,
  ): Promise<AcrAssessmentResponseDto> {
    const scoreInputs = dto.scores ?? [];
    for (const s of scoreInputs) {
      if (!VALID_SCORES.includes(s.score)) throw new BadRequestException('Score must be 1-4');
    }
    const saved = await this.assessments.manager.transaction(async (em) => {
      const aRepo = em.getRepository(AcrAssessment);
      const row = await this.findVisible(aRepo, id, tenantId, callerId, true, true);
      if (row.status === 'COMPLETED')
        throw new ConflictException('Completed ACR is read-only; reopen it first');
      if (scoreInputs.length) {
        const ids = [...new Set(scoreInputs.map((s) => s.criterion_id))];
        const valid = await em.getRepository(AcrCriterion).count({
          where: { tenant_id: tenantId, form_version_id: row.form_version_id, id: In(ids) },
        });
        if (valid !== ids.length)
          throw new BadRequestException('Unknown criterion for this ACR form version');
        const sRepo = em.getRepository(AcrScore);
        // Last write per criterion wins; one upsert (no check-then-insert race).
        const latest = new Map(scoreInputs.map((s) => [s.criterion_id, s.score]));
        await sRepo.upsert(
          [...latest].map(([criterion_id, score]) => ({
            tenant_id: tenantId,
            assessment_id: row.id,
            criterion_id,
            score,
          })),
          ['assessment_id', 'criterion_id'],
        );
        const all = await sRepo.find({ where: { tenant_id: tenantId, assessment_id: row.id } });
        row.total = all.reduce((sum, s) => sum + s.score, 0);
      }
      if (dto.step1_data !== undefined) row.step1_data = dto.step1_data;
      if (dto.step3_data !== undefined) row.step3_data = dto.step3_data;
      return aRepo.save(row);
    });
    return this.toResponse(saved, tenantId);
  }

  async complete(
    id: string,
    tenantId: string,
    callerId: string,
  ): Promise<AcrAssessmentResponseDto> {
    const saved = await this.assessments.manager.transaction(async (em) => {
      const aRepo = em.getRepository(AcrAssessment);
      const row = await this.findVisible(aRepo, id, tenantId, callerId, true, true);
      if (row.status === 'COMPLETED') throw new ConflictException('ACR is already completed');
      const required = await em.getRepository(AcrCriterion).find({
        where: { tenant_id: tenantId, form_version_id: row.form_version_id },
      });
      const scored = await em
        .getRepository(AcrScore)
        .find({ where: { tenant_id: tenantId, assessment_id: row.id } });
      const scoredIds = new Set(scored.map((s) => s.criterion_id));
      if (required.some((c) => !scoredIds.has(c.id)))
        throw new BadRequestException('Every criterion must be scored before completing');
      const oldStatus = row.status;
      row.total = scored.reduce((sum, s) => sum + s.score, 0);
      row.status = 'COMPLETED';
      row.completed_at = new Date();
      const out = await aRepo.save(row);
      await this.audit(out, oldStatus, tenantId, callerId, em);
      return out;
    });
    return this.toResponse(saved, tenantId);
  }

  async reopen(id: string, tenantId: string, callerId: string): Promise<AcrAssessmentResponseDto> {
    const saved = await this.assessments.manager.transaction(async (em) => {
      const aRepo = em.getRepository(AcrAssessment);
      const row = await this.findVisible(aRepo, id, tenantId, callerId, true);
      if (row.status !== 'COMPLETED')
        throw new ConflictException('Only a completed ACR can be reopened');
      const oldStatus = row.status;
      row.status = 'INCOMPLETE';
      row.completed_at = null;
      const out = await aRepo.save(row);
      await this.audit(out, oldStatus, tenantId, callerId, em);
      return out;
    });
    return this.toResponse(saved, tenantId);
  }

  async get(id: string, tenantId: string, callerId: string): Promise<AcrAssessmentResponseDto> {
    const row = await this.findVisible(this.assessments, id, tenantId, callerId);
    return this.toResponse(row, tenantId);
  }

  /** Register. The subject's own row is excluded IN the query (D2), not post-filtered. */
  async list(
    tenantId: string,
    callerId: string,
    filter: { year?: string; status?: AcrAssessmentStatus },
  ): Promise<AcrAssessmentResponseDto[]> {
    const rows = await this.assessments.find({
      where: {
        tenant_id: tenantId,
        user_id: Not(callerId),
        ...(filter.year ? { academic_year_id: filter.year } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      order: { created_at: 'DESC' },
    });
    return this.toResponses(rows, tenantId);
  }

  /** Year-over-year history for one staff member. */
  async history(
    userId: string,
    tenantId: string,
    callerId: string,
  ): Promise<AcrAssessmentResponseDto[]> {
    if (userId === callerId) throw new NotFoundException('ACR assessment not found');
    const rows = await this.assessments.find({
      where: { tenant_id: tenantId, user_id: userId },
      order: { created_at: 'DESC' },
    });
    return this.toResponses(rows, tenantId);
  }

  /** Tenant-scoped load; the subject is indistinguishable from "does not exist". */
  private async findVisible(
    repo: Repository<AcrAssessment>,
    id: string,
    tenantId: string,
    callerId: string,
    lock = false,
    onlyAssessor = false,
  ): Promise<AcrAssessment> {
    const row = await repo.findOne({
      where: { id, tenant_id: tenantId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!row || row.user_id === callerId) throw new NotFoundException('ACR assessment not found');
    // D7: only the assessor edits/completes; reopen is open to any ACR_WRITE holder (D4).
    if (onlyAssessor && row.assessed_by !== callerId)
      throw new ForbiddenException('Only the assessor can change this ACR');
    return row;
  }

  private audit(
    row: AcrAssessment,
    oldStatus: AcrAssessmentStatus,
    tenantId: string,
    actorUserId: string,
    manager: EntityManager,
  ) {
    return this.auditService.record(
      {
        action: AuditAction.UPDATE,
        entity_type: 'AcrAssessment',
        entity_id: row.id,
        tenant_id: tenantId,
        performed_by_user_id: actorUserId,
        old_values: { status: oldStatus },
        // PRIVACY: never put the total in the audit trail.
        new_values: { status: row.status },
      },
      manager,
    );
  }

  private async toResponse(a: AcrAssessment, tenantId: string): Promise<AcrAssessmentResponseDto> {
    return (await this.toResponses([a], tenantId))[0];
  }

  /** One scores query for the whole batch (no N+1). */
  private async toResponses(
    list: AcrAssessment[],
    tenantId: string,
  ): Promise<AcrAssessmentResponseDto[]> {
    const all = list.length
      ? await this.scores.find({
          where: { tenant_id: tenantId, assessment_id: In(list.map((a) => a.id)) },
        })
      : [];
    return list.map((a) => ({
      id: a.id,
      user_id: a.user_id,
      academic_year_id: a.academic_year_id,
      form_version_id: a.form_version_id,
      status: a.status,
      total: a.total,
      assessed_by: a.assessed_by,
      step1_data: a.step1_data,
      step3_data: a.step3_data,
      completed_at: a.completed_at,
      scores: all
        .filter((s) => s.assessment_id === a.id)
        .map((s) => ({ criterion_id: s.criterion_id, score: s.score })),
    }));
  }
}
