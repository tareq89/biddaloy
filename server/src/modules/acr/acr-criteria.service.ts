import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';
import { AcrFormVersion } from './entities/acr-form-version.entity';
import { AcrCriterion } from './entities/acr-criterion.entity';
import { AuditService } from '../audit/audit.service';
import { AcrCriteriaSetResponseDto, SaveAcrCriteriaDto } from './dto/criteria.dto';

/** Copy-on-write ACR criteria: every save is a new version, old ones never mutate (D1). 28.2.1. */
@Injectable()
export class AcrCriteriaService {
  constructor(
    @InjectRepository(AcrFormVersion) private readonly versions: Repository<AcrFormVersion>,
    @InjectRepository(AcrCriterion) private readonly criteria: Repository<AcrCriterion>,
    private readonly auditService: AuditService,
  ) {}

  /** Latest version (max per tenant) with its criteria; empty set if none yet. */
  async getLatest(tenantId: string): Promise<AcrCriteriaSetResponseDto> {
    const latest = await this.versions.findOne({
      where: { tenant_id: tenantId },
      order: { version: 'DESC' },
    });
    if (!latest) return { id: null, version: 0, criteria: [] };
    return this.toResponse(latest, tenantId);
  }

  async save(
    dto: SaveAcrCriteriaDto,
    tenantId: string,
    actorUserId: string,
  ): Promise<AcrCriteriaSetResponseDto> {
    const codes = dto.criteria.map((c) => `${c.block}:${c.code}`);
    if (new Set(codes).size !== codes.length) {
      throw new ConflictException('Criterion codes must be unique within a block');
    }
    let created: AcrFormVersion;
    let previousVersion = 0;
    try {
      created = await this.versions.manager.transaction(async (em) => {
        const vRepo = em.getRepository(AcrFormVersion);
        const latest = await vRepo.findOne({
          where: { tenant_id: tenantId },
          order: { version: 'DESC' },
        });
        previousVersion = latest?.version ?? 0;
        const version = await vRepo.save(
          vRepo.create({
            tenant_id: tenantId,
            version: previousVersion + 1,
            created_by: actorUserId,
          }),
        );
        const cRepo = em.getRepository(AcrCriterion);
        await cRepo.save(
          dto.criteria.map((c) =>
            cRepo.create({ ...c, tenant_id: tenantId, form_version_id: version.id }),
          ),
        );
        return version;
      });
    } catch (err) {
      // Concurrent save hit UQ (tenant_id, version).
      if ((err as { code?: unknown })?.code === '23505') {
        throw new ConflictException('Criteria were changed by someone else; reload and retry');
      }
      throw err;
    }
    await this.auditService.record({
      action: AuditAction.CREATE,
      entity_type: 'AcrFormVersion',
      entity_id: created.id,
      tenant_id: tenantId,
      performed_by_user_id: actorUserId,
      old_values: { version: previousVersion },
      new_values: { version: created.version, criteria: dto.criteria },
    });
    return this.toResponse(created, tenantId);
  }

  private async toResponse(
    v: AcrFormVersion,
    tenantId: string,
  ): Promise<AcrCriteriaSetResponseDto> {
    const rows = await this.criteria.find({
      where: { tenant_id: tenantId, form_version_id: v.id },
      order: { sort_order: 'ASC', code: 'ASC' },
    });
    return {
      id: v.id,
      version: v.version,
      criteria: rows.map((r) => ({
        id: r.id,
        block: r.block,
        code: r.code,
        label_en: r.label_en,
        label_bn: r.label_bn,
        sort_order: r.sort_order,
      })),
    };
  }
}
