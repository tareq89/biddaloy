import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import { AuditAction, FeeType } from '@biddaloy/shared';
import { FineRule } from '../entities/fine-rule.entity';
import { FeeStructure } from '../entities/fee-structure.entity';
import { Class } from '../../academics/entities/class.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import {
  CreateFineRuleDto,
  UpdateFineRuleDto,
  CopyFineRulesDto,
  validateConditionsForTrigger,
} from './dto/fine-rules.dto';
import { AuditService } from '../../audit/audit.service';

const FINE_RULES_UNIQUE_CONSTRAINT = 'IDX_fine_rules_tenant_year_trigger_class';

/** True when `error` is the Postgres unique-violation on the fine_rules
 * partial unique index (D22: one active rule per tenant/year/trigger/class,
 * `NULLS NOT DISTINCT`). Mirrors `isUniqueViolationOn` in
 * staff-profiles.service.ts — duplicated rather than imported, since that
 * helper lives outside this ticket's file territory. */
function isDuplicateFineRule(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as { code?: string; constraint?: string } | undefined;
  return driverError?.code === '23505' && driverError?.constraint === FINE_RULES_UNIQUE_CONSTRAINT;
}

/**
 * [38.2.1] `FineRule` CRUD (tenant-scoped, `FEE_STRUCTURE_*` permission
 * gated at the controller) plus copy-from-last-year. Cloned from
 * `DiscountRulesService`'s shape.
 *
 * A duplicate active (year, trigger, class) is rejected at the DB layer by
 * `IDX_fine_rules_tenant_year_trigger_class` (D22, `NULLS NOT DISTINCT`) —
 * this service catches that unique violation and turns it into a 409
 * instead of a raw 500.
 */
@Injectable()
export class FineRulesService {
  constructor(
    @InjectRepository(FineRule)
    private readonly fineRuleRepo: Repository<FineRule>,
    @InjectRepository(FeeStructure)
    private readonly feeStructureRepo: Repository<FeeStructure>,
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
    @InjectRepository(AcademicYear)
    private readonly academicYearRepo: Repository<AcademicYear>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  /** [Step 3] `fee_structure_id` must name a FINE structure in the same
   * tenant *and* academic year as the rule — a rule pointing at a
   * different year's structure would let `generate()` never bill it. */
  private async assertFineStructureInTenantYear(
    tenantId: string,
    academicYearId: string,
    feeStructureId: string,
  ): Promise<FeeStructure> {
    const structure = await this.feeStructureRepo.findOne({
      where: { id: feeStructureId, tenant_id: tenantId },
    });
    if (!structure) {
      throw new NotFoundException('Fee structure not found in this tenant');
    }
    if (structure.fee_type !== FeeType.FINE) {
      throw new BadRequestException('fee_structure_id must reference a FINE fee structure');
    }
    if (structure.academic_year_id !== academicYearId) {
      throw new BadRequestException('fee_structure_id must belong to the same academic year');
    }
    return structure;
  }

  private async assertClassInTenant(
    tenantId: string,
    classId: string,
    academicYearId: string,
  ): Promise<void> {
    const klass = await this.classRepo.findOne({ where: { id: classId, tenant_id: tenantId } });
    if (!klass) {
      throw new BadRequestException('class_id not found in this tenant');
    }
    // A rule is per academic year; its class must belong to that same year.
    if (klass.academic_year_id !== academicYearId) {
      throw new BadRequestException(
        "class_id belongs to a different academic year than the rule's",
      );
    }
  }

  async list(tenantId: string, academicYearId: string): Promise<FineRule[]> {
    return this.fineRuleRepo.find({
      where: { tenant_id: tenantId, academic_year_id: academicYearId },
      relations: { fee_structure: true, class: true },
      order: { created_at: 'DESC' },
    });
  }

  async create(tenantId: string, userId: string, dto: CreateFineRuleDto): Promise<FineRule> {
    await this.assertFineStructureInTenantYear(
      tenantId,
      dto.academic_year_id,
      dto.fee_structure_id,
    );
    if (dto.class_id) {
      await this.assertClassInTenant(tenantId, dto.class_id, dto.academic_year_id);
    }
    if (!validateConditionsForTrigger(dto.trigger, dto.conditions)) {
      throw new BadRequestException('conditions has an unknown key for this trigger');
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(FineRule);
      const rule = repo.create({
        tenant_id: tenantId,
        academic_year_id: dto.academic_year_id,
        trigger: dto.trigger,
        fee_structure_id: dto.fee_structure_id,
        class_id: dto.class_id ?? null,
        free_per_period: dto.free_per_period ?? 0,
        cap_per_period: dto.cap_per_period ?? null,
        conditions: dto.conditions ?? {},
        created_by_user_id: userId,
      });
      let saved: FineRule;
      try {
        saved = await repo.save(rule);
      } catch (error) {
        if (isDuplicateFineRule(error)) {
          throw new ConflictException(
            'An active fine rule already exists for this year, trigger and class',
          );
        }
        throw error;
      }
      await this.auditService.record(
        {
          action: AuditAction.CREATE,
          entity_type: 'FineRule',
          entity_id: saved.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          new_values: saved as unknown as Record<string, unknown>,
        },
        manager,
      );
      // Reload with relations — toFineRuleDto() needs fee_structure/class names.
      return repo.findOneOrFail({
        where: { id: saved.id },
        relations: { fee_structure: true, class: true },
      });
    });
  }

  async update(
    tenantId: string,
    id: string,
    userId: string,
    dto: UpdateFineRuleDto,
  ): Promise<FineRule> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(FineRule);
      const rule = await repo.findOne({ where: { id, tenant_id: tenantId } });
      if (!rule) throw new NotFoundException('Fine rule not found');
      const oldValues = { ...rule } as unknown as Record<string, unknown>;

      if (dto.fee_structure_id !== undefined) {
        await this.assertFineStructureInTenantYear(
          tenantId,
          rule.academic_year_id,
          dto.fee_structure_id,
        );
      }
      if (dto.class_id) {
        await this.assertClassInTenant(tenantId, dto.class_id, rule.academic_year_id);
      }
      const mergedConditions = dto.conditions !== undefined ? dto.conditions : rule.conditions;
      if (!validateConditionsForTrigger(rule.trigger, mergedConditions)) {
        throw new BadRequestException('conditions has an unknown key for this trigger');
      }

      Object.assign(rule, {
        ...(dto.fee_structure_id !== undefined && { fee_structure_id: dto.fee_structure_id }),
        ...(dto.class_id !== undefined && { class_id: dto.class_id }),
        ...(dto.free_per_period !== undefined && { free_per_period: dto.free_per_period }),
        ...(dto.cap_per_period !== undefined && { cap_per_period: dto.cap_per_period }),
        ...(dto.conditions !== undefined && { conditions: dto.conditions }),
        ...(dto.is_active !== undefined && { is_active: dto.is_active }),
      });

      let saved: FineRule;
      try {
        saved = await repo.save(rule);
      } catch (error) {
        if (isDuplicateFineRule(error)) {
          throw new ConflictException(
            'An active fine rule already exists for this year, trigger and class',
          );
        }
        throw error;
      }
      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'FineRule',
          entity_id: saved.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          old_values: oldValues,
          new_values: saved as unknown as Record<string, unknown>,
        },
        manager,
      );
      // Reload with relations — toFineRuleDto() needs fee_structure/class names.
      return repo.findOneOrFail({
        where: { id: saved.id },
        relations: { fee_structure: true, class: true },
      });
    });
  }

  async remove(tenantId: string, id: string, userId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(FineRule);
      const rule = await repo.findOne({ where: { id, tenant_id: tenantId } });
      if (!rule) throw new NotFoundException('Fine rule not found');
      await repo.softDelete({ id, tenant_id: tenantId });
      await this.auditService.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'FineRule',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          old_values: rule as unknown as Record<string, unknown>,
        },
        manager,
      );
    });
  }

  /**
   * [Step 4] For each FINE structure in the source year, create or reuse a
   * same-name FINE structure in the target year (same amount), then copy
   * each non-deleted rule onto it. A rule that would collide with one
   * already in the target year (D22's unique index) is skipped and
   * reported, not retried — the caller decides whether to hand-fix it.
   * Idempotent: running it twice reports everything as `skipped` the
   * second time, since every structure/rule already exists.
   */
  async copy(
    tenantId: string,
    userId: string,
    dto: CopyFineRulesDto,
  ): Promise<{ structures_created: number; rules_created: number; skipped: number }> {
    // Both years must belong to this tenant — otherwise a caller could copy
    // into/from another school's academic year (tenant isolation).
    const [fromYear, toYear] = await Promise.all([
      this.academicYearRepo.findOne({
        where: { id: dto.from_academic_year_id, tenant_id: tenantId },
      }),
      this.academicYearRepo.findOne({
        where: { id: dto.to_academic_year_id, tenant_id: tenantId },
      }),
    ]);
    if (!fromYear || !toYear) {
      throw new NotFoundException('Academic year not found in this tenant');
    }
    if (dto.from_academic_year_id === dto.to_academic_year_id) {
      throw new BadRequestException('from_academic_year_id and to_academic_year_id must differ');
    }

    return this.dataSource.transaction(async (manager) => {
      const feeStructureRepo = manager.getRepository(FeeStructure);
      const fineRuleRepo = manager.getRepository(FineRule);
      const classRepo = manager.getRepository(Class);
      const classSectionRepo = manager.getRepository(ClassSection);

      // A Class/ClassSection belongs to exactly one academic year, so the
      // source year's class/section ids never exist in the target year —
      // map by (name, shift, version) / (class, section_name) instead, and
      // skip when no equivalent exists there rather than pointing at a
      // class from the wrong year (that would never match any student).
      const classCache = new Map<string, string | null>(); // source class id -> target class id | null (unmappable)
      const resolveClassInTargetYear = async (sourceClassId: string): Promise<string | null> => {
        if (classCache.has(sourceClassId)) return classCache.get(sourceClassId)!;
        const source = await classRepo.findOne({
          where: { id: sourceClassId, tenant_id: tenantId },
        });
        const target = source
          ? await classRepo.findOne({
              where: {
                tenant_id: tenantId,
                academic_year_id: dto.to_academic_year_id,
                name: source.name,
                shift: source.shift ?? IsNull(),
                version: source.version ?? IsNull(),
              },
            })
          : null;
        classCache.set(sourceClassId, target?.id ?? null);
        return target?.id ?? null;
      };
      const resolveSectionInTargetClass = async (
        sourceSectionId: string,
        targetClassId: string,
      ): Promise<string | null> => {
        const source = await classSectionRepo.findOne({
          where: { id: sourceSectionId, tenant_id: tenantId },
        });
        if (!source) return null;
        const target = await classSectionRepo.findOne({
          where: {
            tenant_id: tenantId,
            class_id: targetClassId,
            section_name: source.section_name,
          },
        });
        return target?.id ?? null;
      };

      const sourceStructures = await feeStructureRepo.find({
        where: {
          tenant_id: tenantId,
          academic_year_id: dto.from_academic_year_id,
          fee_type: FeeType.FINE,
        },
      });

      let structuresCreated = 0;
      let rulesCreated = 0;
      let skipped = 0;
      const structureIdMap = new Map<string, string>(); // source structure id -> target structure id

      for (const source of sourceStructures) {
        const targetClassId = source.class_id
          ? await resolveClassInTargetYear(source.class_id)
          : null;
        if (source.class_id && !targetClassId) {
          skipped += 1;
          continue;
        }
        const targetSectionId =
          source.section_id && targetClassId
            ? await resolveSectionInTargetClass(source.section_id, targetClassId)
            : null;

        let target = await feeStructureRepo.findOne({
          where: {
            tenant_id: tenantId,
            academic_year_id: dto.to_academic_year_id,
            fee_type: FeeType.FINE,
            name: source.name,
          },
        });
        if (!target) {
          target = await feeStructureRepo.save(
            feeStructureRepo.create({
              tenant_id: tenantId,
              academic_year_id: dto.to_academic_year_id,
              fee_type: FeeType.FINE,
              name: source.name,
              amount: source.amount,
              class_id: targetClassId,
              section_id: targetSectionId,
            }),
          );
          structuresCreated += 1;
        }
        structureIdMap.set(source.id, target.id);
      }

      // Only copy active rules — an inactive one shouldn't come back to
      // life in the new year, and copying it would also break idempotency
      // (the active-only collision check below would never match it, so
      // re-running `copy` would insert another inactive duplicate each time).
      const sourceRules = await fineRuleRepo.find({
        where: {
          tenant_id: tenantId,
          academic_year_id: dto.from_academic_year_id,
          is_active: true,
        },
        withDeleted: false,
      });

      for (const rule of sourceRules) {
        const targetStructureId = structureIdMap.get(rule.fee_structure_id);
        if (!targetStructureId) {
          skipped += 1;
          continue;
        }
        const targetClassId = rule.class_id ? await resolveClassInTargetYear(rule.class_id) : null;
        if (rule.class_id && !targetClassId) {
          skipped += 1;
          continue;
        }
        // Matches the partial unique index (active, non-deleted rows only) —
        // a soft-deleted or inactive rule in the target year must not block
        // this copy, since the DB itself would allow the insert.
        const existing = await fineRuleRepo.findOne({
          where: {
            tenant_id: tenantId,
            academic_year_id: dto.to_academic_year_id,
            trigger: rule.trigger,
            class_id: targetClassId ?? IsNull(),
            is_active: true,
          },
        });
        if (existing) {
          skipped += 1;
          continue;
        }
        const created = fineRuleRepo.create({
          tenant_id: tenantId,
          academic_year_id: dto.to_academic_year_id,
          trigger: rule.trigger,
          fee_structure_id: targetStructureId,
          class_id: targetClassId,
          free_per_period: rule.free_per_period,
          cap_per_period: rule.cap_per_period,
          conditions: rule.conditions,
          created_by_user_id: userId,
        });
        try {
          await fineRuleRepo.save(created);
          rulesCreated += 1;
        } catch (error) {
          if (isDuplicateFineRule(error)) {
            skipped += 1;
            continue;
          }
          throw error;
        }
      }

      await this.auditService.record(
        {
          action: AuditAction.CREATE,
          entity_type: 'FineRule',
          entity_id: null,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          new_values: {
            from_academic_year_id: dto.from_academic_year_id,
            to_academic_year_id: dto.to_academic_year_id,
            structures_created: structuresCreated,
            rules_created: rulesCreated,
            skipped,
          },
        },
        manager,
      );

      return { structures_created: structuresCreated, rules_created: rulesCreated, skipped };
    });
  }
}
