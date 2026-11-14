import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { ApprovalScope, AuditAction } from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import { MoneyNoticesService } from '../billing/money-notices.service';
import type {
  AssignPlanDto,
  CreatePlanDto,
  PlanDto,
  PlanPriceDto,
  UpdatePlanDto,
} from './dto/plan.dto';
import { Plan } from './entities/plan.entity';

// Fixed sentences: nothing the caller sent is echoed (Rule 23).
const NOT_FOUND = 'Plan not found';
const NAME_TAKEN = 'PLAN_NAME_TAKEN';
const IS_DEFAULT = 'PLAN_IS_DEFAULT';
const NOT_AVAILABLE = 'PLAN_NOT_AVAILABLE';

export interface PlanActor {
  userId: string;
  approverId?: string;
  ip?: string | null;
  userAgent?: string | null;
}

const toDto = (p: Plan): PlanDto => ({
  id: p.id,
  name: p.name,
  unit_price_paisa: p.unit_price_paisa,
  active: p.active,
  is_default: p.is_default,
});

const snap = (p: Plan) => ({
  name: p.name,
  unit_price_paisa: p.unit_price_paisa,
  active: p.active,
  is_default: p.is_default,
});

/** Unique lower(name) violation becomes a fixed 409. */
const mapUnique = (e: unknown): never => {
  if (e instanceof QueryFailedError && (e.driverError as { code?: string })?.code === '23505')
    throw new ConflictException({ code: 'PLAN_NAME_TAKEN', message: NAME_TAKEN });
  throw e;
};

/** [100.3.02] The owner's plan catalog and a school's plan. A price change never touches an existing order. */
@Injectable()
export class PlansService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly audit: AuditService,
    private readonly notices: MoneyNoticesService,
  ) {}

  async list(limit = 100): Promise<PlanDto[]> {
    const rows = await this.ds.getRepository(Plan).find({
      order: { created_at: 'ASC', id: 'ASC' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map(toDto);
  }

  /** What a school pays per seat per month. A deactivated plan keeps its price for the schools on it. */
  async priceFor(schoolId: string, m?: EntityManager): Promise<PlanPriceDto> {
    const [r]: { id: string; name: string; unit_price_paisa: number }[] = await (
      m ?? this.ds
    ).query(
      `SELECT p.id, p.name, p.unit_price_paisa FROM schools s JOIN plans p ON p.id = s.plan_id WHERE s.id = $1`,
      [schoolId],
    );
    if (!r) throw new NotFoundException('School not found');
    return { planId: r.id, name: r.name, unitPricePaisa: r.unit_price_paisa };
  }

  async create(dto: CreatePlanDto, actor: PlanActor): Promise<PlanDto> {
    try {
      return await this.ds.transaction(async (m) => {
        const repo = m.getRepository(Plan);
        const saved = await repo.save(
          repo.create({ name: dto.name, unit_price_paisa: dto.unit_price_paisa, active: true }),
        );
        await this.record(m, AuditAction.PLAN_CREATED, saved.id, actor, undefined, snap(saved));
        return toDto(saved);
      });
    } catch (e) {
      return mapUnique(e);
    }
  }

  async update(id: string, dto: UpdatePlanDto, actor: PlanActor): Promise<PlanDto> {
    try {
      return await this.ds.transaction(async (m) => {
        const repo = m.getRepository(Plan);
        const row = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
        if (!row) throw new NotFoundException(NOT_FOUND);
        // Checked here: the DB CHECK would fail with an unmapped error.
        if (dto.active === false && row.is_default)
          throw new ConflictException({ code: 'PLAN_IS_DEFAULT', message: IS_DEFAULT });
        const before = snap(row);
        if (dto.name !== undefined) row.name = dto.name;
        if (dto.unit_price_paisa !== undefined) row.unit_price_paisa = dto.unit_price_paisa;
        if (dto.active !== undefined) row.active = dto.active;
        const saved = await repo.save(row);
        const action =
          before.active && !saved.active ? AuditAction.PLAN_DEACTIVATED : AuditAction.PLAN_UPDATED;
        await this.record(m, action, id, actor, before, snap(saved));
        return toDto(saved);
      });
    } catch (e) {
      return mapUnique(e);
    }
  }

  /** One transaction moves the default. Every plan row is locked first, so two callers queue up. */
  async makeDefault(id: string, actor: PlanActor): Promise<PlanDto> {
    return this.ds.transaction(async (m) => {
      await m.query(`SELECT id FROM plans ORDER BY id FOR UPDATE`);
      const repo = m.getRepository(Plan);
      const target = await repo.findOne({ where: { id } });
      if (!target) throw new NotFoundException(NOT_FOUND);
      if (!target.active)
        throw new ConflictException({ code: 'PLAN_NOT_AVAILABLE', message: NOT_AVAILABLE });
      if (target.is_default) return toDto(target);
      const old = await repo.findOne({ where: { is_default: true } });
      if (old) {
        await repo.update(old.id, { is_default: false });
        await this.record(m, AuditAction.PLAN_UPDATED, old.id, actor, snap(old), {
          ...snap(old),
          is_default: false,
        });
      }
      const before = snap(target);
      await repo.update(id, { is_default: true });
      target.is_default = true;
      await this.record(m, AuditAction.PLAN_UPDATED, id, actor, before, snap(target));
      return toDto(target);
    });
  }

  /** Moves a school onto an active plan. Same plan is a no-op. Only the school's next order is priced by it. */
  async assign(schoolId: string, dto: AssignPlanDto, actor: PlanActor): Promise<PlanPriceDto> {
    let changed = false;
    const result = await this.ds.transaction(async (m) => {
      const [school]: { plan_id: string }[] = await m.query(
        `SELECT plan_id FROM schools WHERE id = $1 FOR NO KEY UPDATE`,
        [schoolId],
      );
      if (!school) throw new NotFoundException('School not found');
      const repo = m.getRepository(Plan);
      const target = await repo.findOne({ where: { id: dto.plan_id } });
      if (!target || !target.active)
        throw new ConflictException({ code: 'PLAN_NOT_AVAILABLE', message: NOT_AVAILABLE });
      if (school.plan_id === target.id)
        return { planId: target.id, name: target.name, unitPricePaisa: target.unit_price_paisa };
      const old = await repo.findOneOrFail({ where: { id: school.plan_id } });
      await m.query(`UPDATE schools SET plan_id = $2 WHERE id = $1`, [schoolId, target.id]);
      await this.audit.recordApproved(
        {
          action: AuditAction.PLAN_ASSIGNED,
          entity_type: 'School',
          entity_id: schoolId,
          tenant_id: schoolId,
          performed_by_user_id: actor.userId,
          ip_address: actor.ip ?? null,
          user_agent: actor.userAgent ?? null,
          old_values: { plan_id: old.id, plan_name: old.name, reason: dto.reason },
          new_values: { plan_id: target.id, plan_name: target.name, reason: dto.reason },
          approved_by_user_id: actor.approverId ?? actor.userId,
          approval_scope: ApprovalScope.PLATFORM_PLAN,
        },
        m,
      );
      changed = true;
      return { planId: target.id, name: target.name, unitPricePaisa: target.unit_price_paisa };
    });
    // After commit; the notice service never throws, the guard is belt and braces.
    if (changed) await this.notices.planChanged(schoolId, result.name).catch(() => undefined);
    return result;
  }

  private record(
    m: EntityManager,
    action: AuditAction,
    id: string,
    actor: PlanActor,
    old: Record<string, unknown> | undefined,
    next: Record<string, unknown>,
  ) {
    return this.audit.recordApproved(
      {
        action,
        entity_type: 'Plan',
        entity_id: id,
        tenant_id: null,
        performed_by_user_id: actor.userId,
        ip_address: actor.ip ?? null,
        user_agent: actor.userAgent ?? null,
        old_values: old,
        new_values: next,
        approved_by_user_id: actor.approverId ?? actor.userId,
        approval_scope: ApprovalScope.PLATFORM_PLAN,
      },
      m,
    );
  }
}
