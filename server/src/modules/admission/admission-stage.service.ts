import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { AdmissionIntake } from './entities/admission-intake.entity';
import { AdmissionStage } from './entities/admission-stage.entity';
import { AdmissionStageResult } from './entities/admission-stage-result.entity';
import { CreateStageDto, UpdateStageDto } from './dto/stage.dto';
import { assertYearOpen } from '../../common/utils/year-open.guard';
import { admissionStageHasResults } from '../../common/filters/known-errors';

const MAX_CONFIG_CHARS = 2000;

function assertConfigSize(config: Record<string, unknown> | undefined): void {
  if (config && JSON.stringify(config).length > MAX_CONFIG_CHARS) {
    throw new BadRequestException('Stage config is too large');
  }
}

/** [Epic 71 D1] Create/update/list/delete the stages of one round. Tenant-scoped; a write on a
 * round of a closed year is refused (Rule 28). Rounds from before Epic 71 have no year. */
@Injectable()
export class AdmissionStageService {
  constructor(
    @InjectRepository(AdmissionStage) private readonly stages: Repository<AdmissionStage>,
    private readonly dataSource: DataSource,
  ) {}

  /** Locks the round row for the write; 404 when it is not this tenant's. */
  private async lockIntake(
    manager: EntityManager,
    intakeId: string,
    tenantId: string,
  ): Promise<AdmissionIntake> {
    const intake = await manager
      .getRepository(AdmissionIntake)
      .createQueryBuilder('i')
      .setLock('pessimistic_write')
      .where('i.id = :intakeId AND i.tenant_id = :tenantId AND i.deleted_at IS NULL', {
        intakeId,
        tenantId,
      })
      .getOne();
    if (!intake) throw new NotFoundException('Admission intake not found');
    if (intake.academic_year_id) await assertYearOpen(manager, tenantId, intake.academic_year_id);
    return intake;
  }

  private async getStage(
    manager: EntityManager,
    id: string,
    intakeId: string,
    tenantId: string,
  ): Promise<AdmissionStage> {
    const stage = await manager.getRepository(AdmissionStage).findOne({
      where: { id, intake_id: intakeId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!stage) throw new NotFoundException('Admission stage not found');
    return stage;
  }

  async list(intakeId: string, tenantId: string): Promise<AdmissionStage[]> {
    const intake = await this.dataSource
      .getRepository(AdmissionIntake)
      .findOne({ where: { id: intakeId, tenant_id: tenantId, deleted_at: IsNull() } });
    if (!intake) throw new NotFoundException('Admission intake not found');
    return this.stages.find({
      where: { intake_id: intakeId, tenant_id: tenantId, deleted_at: IsNull() },
      order: { position: 'ASC' },
    });
  }

  async create(intakeId: string, dto: CreateStageDto, tenantId: string): Promise<AdmissionStage> {
    assertConfigSize(dto.config);
    return this.dataSource.transaction(async (manager) => {
      await this.lockIntake(manager, intakeId, tenantId);
      const repo = manager.getRepository(AdmissionStage);
      const { max } = (await repo
        .createQueryBuilder('s')
        .select('COALESCE(MAX(s.position), 0)', 'max')
        .where('s.intake_id = :intakeId AND s.tenant_id = :tenantId AND s.deleted_at IS NULL', {
          intakeId,
          tenantId,
        })
        .getRawOne()) as { max: number };
      return repo.save(
        repo.create({
          tenant_id: tenantId,
          intake_id: intakeId,
          position: Number(max) + 1,
          kind: dto.kind,
          title: dto.title ?? null,
          config: dto.config ?? {},
        }),
      );
    });
  }

  async update(
    intakeId: string,
    id: string,
    dto: UpdateStageDto,
    tenantId: string,
  ): Promise<AdmissionStage> {
    assertConfigSize(dto.config);
    return this.dataSource.transaction(async (manager) => {
      await this.lockIntake(manager, intakeId, tenantId);
      const stage = await this.getStage(manager, id, intakeId, tenantId);
      if (dto.kind !== undefined) stage.kind = dto.kind;
      if (dto.title !== undefined) stage.title = dto.title;
      if (dto.config !== undefined) stage.config = dto.config;
      return manager.getRepository(AdmissionStage).save(stage);
    });
  }

  async remove(intakeId: string, id: string, tenantId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.lockIntake(manager, intakeId, tenantId);
      const stage = await this.getStage(manager, id, intakeId, tenantId);
      const results = await manager
        .getRepository(AdmissionStageResult)
        .count({ where: { stage_id: stage.id, tenant_id: tenantId } });
      if (results > 0) throw admissionStageHasResults();
      await manager.getRepository(AdmissionStage).softDelete({ id: stage.id, tenant_id: tenantId });
    });
  }
}
