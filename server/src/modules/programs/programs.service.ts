import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditAction, ProgramEnrollmentStatus } from '@biddaloy/shared';
import { Program } from './entities/program.entity';
import { ProgramMilestone } from './entities/program-milestone.entity';
import { ProgramEnrollment } from './entities/program-enrollment.entity';
import { MilestoneAchievement } from './entities/milestone-achievement.entity';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import {
  CreateMilestoneDto,
  CreateProgramDto,
  UpdateMilestoneDto,
  UpdateProgramDto,
} from './dto/programs.dto';

const NO_CONTEXT: RequestContext = { ip: null, userAgent: null };

/**
 * [34.1.3] `Program`/`ProgramMilestone` CRUD, archive, and the D23 delete
 * rules. Enrolment and achievement recording come in 34.2.1 — this
 * service only reads `ProgramEnrollment`/`MilestoneAchievement` counts to
 * gate/report deletes. Tenant-scoping and `AuditService.record` call
 * shape cloned from `grading.service.ts`.
 */
@Injectable()
export class ProgramsService {
  constructor(
    @InjectRepository(Program)
    private readonly programRepo: Repository<Program>,
    @InjectRepository(ProgramMilestone)
    private readonly milestoneRepo: Repository<ProgramMilestone>,
    @InjectRepository(ProgramEnrollment)
    private readonly enrollmentRepo: Repository<ProgramEnrollment>,
    @InjectRepository(MilestoneAchievement)
    private readonly achievementRepo: Repository<MilestoneAchievement>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async list(
    tenantId: string,
    includeArchived: boolean,
  ): Promise<
    Array<{ program: Program; milestone_count: number; active_enrollment_count: number }>
  > {
    const where: Record<string, unknown> = { tenant_id: tenantId };
    if (!includeArchived) where.is_active = true;
    const programs = await this.programRepo.find({ where, order: { created_at: 'DESC' } });

    return Promise.all(
      programs.map(async (program) => {
        const [milestone_count, active_enrollment_count] = await Promise.all([
          this.milestoneRepo.count({ where: { tenant_id: tenantId, program_id: program.id } }),
          this.enrollmentRepo.count({
            where: {
              tenant_id: tenantId,
              program_id: program.id,
              status: ProgramEnrollmentStatus.ACTIVE,
            },
          }),
        ]);
        return { program, milestone_count, active_enrollment_count };
      }),
    );
  }

  async findOne(id: string, tenantId: string): Promise<Program> {
    const program = await this.programRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!program) throw new NotFoundException(`Program "${id}" not found`);
    return program;
  }

  async findMilestones(programId: string, tenantId: string): Promise<ProgramMilestone[]> {
    return this.milestoneRepo.find({
      where: { program_id: programId, tenant_id: tenantId },
      order: { sequence: 'ASC' },
    });
  }

  /** [D23] Milestones plus each one's achievement count, so a delete
   * confirm can show the count *before* the delete — `removeMilestone`'s
   * response only has it after the cascade already ran. */
  async findMilestonesWithAchievementCounts(
    programId: string,
    tenantId: string,
  ): Promise<Array<{ milestone: ProgramMilestone; achievement_count: number }>> {
    const milestones = await this.findMilestones(programId, tenantId);
    if (milestones.length === 0) return [];

    const counts = await this.achievementRepo
      .createQueryBuilder('a')
      .select('a.milestone_id', 'milestone_id')
      .addSelect('COUNT(*)', 'count')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.milestone_id IN (:...ids)', { ids: milestones.map((m) => m.id) })
      .groupBy('a.milestone_id')
      .getRawMany<{ milestone_id: string; count: string }>();
    const countByMilestoneId = new Map(counts.map((c) => [c.milestone_id, Number(c.count)]));

    return milestones.map((milestone) => ({
      milestone,
      achievement_count: countByMilestoneId.get(milestone.id) ?? 0,
    }));
  }

  async create(
    tenantId: string,
    userId: string | null,
    dto: CreateProgramDto,
    context: RequestContext = NO_CONTEXT,
  ): Promise<Program> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Program);
      // Checked first so a duplicate 409s with a message instead of a raw
      // 23505 on the (tenant_id, name) unique index.
      const existing = await repo.findOne({ where: { tenant_id: tenantId, name: dto.name } });
      if (existing) {
        throw new ConflictException(`A program named "${dto.name}" already exists`);
      }

      const entity = repo.create({
        tenant_id: tenantId,
        name: dto.name,
        description: dto.description ?? null,
        show_on_report_card: dto.show_on_report_card ?? false,
      });
      const saved = await repo.save(entity);

      await this.auditService.record(
        {
          action: AuditAction.CREATE,
          entity_type: 'Program',
          entity_id: saved.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: null,
          new_values: { name: saved.name, show_on_report_card: saved.show_on_report_card },
        },
        manager,
      );

      return saved;
    });
  }

  async update(
    id: string,
    tenantId: string,
    userId: string | null,
    dto: UpdateProgramDto,
    context: RequestContext = NO_CONTEXT,
  ): Promise<Program> {
    const existing = await this.findOne(id, tenantId);

    const changes: Partial<Program> = {};
    if (dto.name !== undefined) changes.name = dto.name;
    if (dto.description !== undefined) changes.description = dto.description;
    if (dto.show_on_report_card !== undefined)
      changes.show_on_report_card = dto.show_on_report_card;
    if (dto.is_active !== undefined) changes.is_active = dto.is_active;

    if (Object.keys(changes).length === 0) return existing;

    if (changes.name !== undefined && changes.name !== existing.name) {
      const nameTaken = await this.programRepo.findOne({
        where: { tenant_id: tenantId, name: changes.name },
      });
      if (nameTaken) {
        throw new ConflictException(`A program named "${changes.name}" already exists`);
      }
    }

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Program);
      await repo.update({ id, tenant_id: tenantId }, changes);
      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'Program',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: {
            name: existing.name,
            description: existing.description,
            show_on_report_card: existing.show_on_report_card,
            is_active: existing.is_active,
          },
          new_values: changes,
        },
        manager,
      );
    });

    return this.findOne(id, tenantId);
  }

  /** Archive is a `PATCH` with `is_active: false` (D27) — a thin wrapper
   * kept for callers that want the intent explicit. */
  async archive(
    id: string,
    tenantId: string,
    userId: string | null,
    context: RequestContext = NO_CONTEXT,
  ): Promise<Program> {
    return this.update(id, tenantId, userId, { is_active: false }, context);
  }

  /** [D23] Hard delete only when the program has zero enrolments —
   * milestones cascade by FK. Otherwise a 409 telling the caller to
   * archive instead. */
  async remove(
    id: string,
    tenantId: string,
    userId: string | null,
    context: RequestContext = NO_CONTEXT,
  ): Promise<void> {
    const existing = await this.findOne(id, tenantId);
    const enrolmentCount = await this.enrollmentRepo.count({
      where: { tenant_id: tenantId, program_id: id },
    });
    if (enrolmentCount > 0) {
      throw new ConflictException(`Program has ${enrolmentCount} enrolments; archive it instead`);
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Program).delete({ id, tenant_id: tenantId });
      await this.auditService.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'Program',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { name: existing.name },
          new_values: null,
        },
        manager,
      );
    });
  }

  async addMilestone(
    programId: string,
    tenantId: string,
    userId: string | null,
    dto: CreateMilestoneDto,
    context: RequestContext = NO_CONTEXT,
  ): Promise<ProgramMilestone> {
    await this.findOne(programId, tenantId);

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ProgramMilestone);
      const existing = await repo.find({
        where: { program_id: programId, tenant_id: tenantId },
        order: { sequence: 'DESC' },
        take: 1,
      });
      const nextSequence = (existing[0]?.sequence ?? 0) + 1;

      const entity = repo.create({
        tenant_id: tenantId,
        program_id: programId,
        name: dto.name,
        description: dto.description ?? null,
        sequence: nextSequence,
      });
      const saved = await repo.save(entity);

      await this.auditService.record(
        {
          action: AuditAction.CREATE,
          entity_type: 'ProgramMilestone',
          entity_id: saved.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: null,
          new_values: { program_id: programId, name: saved.name, sequence: saved.sequence },
        },
        manager,
      );

      return saved;
    });
  }

  async findMilestone(
    programId: string,
    milestoneId: string,
    tenantId: string,
  ): Promise<ProgramMilestone> {
    await this.findOne(programId, tenantId);
    const milestone = await this.milestoneRepo.findOne({
      where: { id: milestoneId, program_id: programId, tenant_id: tenantId },
    });
    if (!milestone) throw new NotFoundException(`Milestone "${milestoneId}" not found`);
    return milestone;
  }

  async updateMilestone(
    programId: string,
    milestoneId: string,
    tenantId: string,
    userId: string | null,
    dto: UpdateMilestoneDto,
    context: RequestContext = NO_CONTEXT,
  ): Promise<ProgramMilestone> {
    const existing = await this.findMilestone(programId, milestoneId, tenantId);

    const changes: Partial<ProgramMilestone> = {};
    if (dto.name !== undefined) changes.name = dto.name;
    if (dto.description !== undefined) changes.description = dto.description;
    if (Object.keys(changes).length === 0) return existing;

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ProgramMilestone);
      await repo.update({ id: milestoneId, tenant_id: tenantId }, changes);
      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'ProgramMilestone',
          entity_id: milestoneId,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { name: existing.name, description: existing.description },
          new_values: changes,
        },
        manager,
      );
    });

    return this.findMilestone(programId, milestoneId, tenantId);
  }

  /** [D23] Reports the achievement count removed by the FK cascade so the
   * caller can show a confirm step. */
  async removeMilestone(
    programId: string,
    milestoneId: string,
    tenantId: string,
    userId: string | null,
    context: RequestContext = NO_CONTEXT,
  ): Promise<{ achievements_removed: number }> {
    const existing = await this.findMilestone(programId, milestoneId, tenantId);
    const achievementsRemoved = await this.achievementRepo.count({
      where: { tenant_id: tenantId, milestone_id: milestoneId },
    });

    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(ProgramMilestone)
        .delete({ id: milestoneId, tenant_id: tenantId });

      await this.auditService.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'ProgramMilestone',
          entity_id: milestoneId,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { name: existing.name, achievements_removed: achievementsRemoved },
          new_values: null,
        },
        manager,
      );
    });

    return { achievements_removed: achievementsRemoved };
  }

  /** Rewrites `sequence` for every milestone in `milestoneIds`' order,
   * inside one transaction — the unique index on (program_id, sequence)
   * is deferrable, so the writes can pass through intermediate collisions
   * as long as the set is unique by commit time. */
  async reorder(
    programId: string,
    tenantId: string,
    userId: string | null,
    milestoneIds: string[],
    context: RequestContext = NO_CONTEXT,
  ): Promise<ProgramMilestone[]> {
    await this.findOne(programId, tenantId);
    const current = await this.findMilestones(programId, tenantId);

    const currentIds = new Set(current.map((m) => m.id));
    const requestedIds = new Set(milestoneIds);
    if (
      currentIds.size !== requestedIds.size ||
      ![...currentIds].every((id) => requestedIds.has(id))
    ) {
      throw new ConflictException(
        "milestone_ids must be exactly the program's current milestone ids",
      );
    }

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ProgramMilestone);
      // Sequential, not Promise.all: the constraint is deferred but TypeORM
      // advises against concurrent queries sharing one transaction's
      // connection.
      for (const [index, id] of milestoneIds.entries()) {
        await repo.update({ id, tenant_id: tenantId }, { sequence: index + 1 });
      }

      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'Program',
          entity_id: programId,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: null,
          new_values: { reordered_milestone_ids: milestoneIds },
        },
        manager,
      );
    });

    return this.findMilestones(programId, tenantId);
  }
}
