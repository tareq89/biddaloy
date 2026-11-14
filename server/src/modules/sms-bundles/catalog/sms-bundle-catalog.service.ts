import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryFailedError } from 'typeorm';
import { ApprovalScope, AuditAction } from '@biddaloy/shared';
import { toPaisa } from '../../../common/constants/money';
import { AuditService } from '../../audit/audit.service';
import { PlatformHomeService } from '../../platform-identity/platform-home.service';
import { SmsBundleCatalog } from '../entities/sms-bundle-catalog.entity';
import type {
  CreateSmsPackageDto,
  SmsPackageDto,
  UpdateSmsPackageDto,
} from './dto/sms-bundle-catalog.dto';

const NOT_FOUND = 'SMS package not found';
const NAME_TAKEN = 'An active SMS package already uses this name';

export interface CatalogActor {
  userId: string;
  approverId?: string;
  ip?: string | null;
  userAgent?: string | null;
}

const taka = (paisa: string) => {
  const p = paisa.padStart(3, '0');
  return `${p.slice(0, -2)}.${p.slice(-2)}`;
};

const toDto = (r: SmsBundleCatalog): SmsPackageDto => ({
  id: r.id,
  name: r.name,
  smsCount: r.sms_count,
  validityDays: r.validity_days,
  pricePaisa: String(r.price_paisa),
  priceTaka: taka(String(r.price_paisa)),
  active: r.active,
});

const snap = (r: SmsBundleCatalog) => ({
  name: r.name,
  sms_count: r.sms_count,
  validity_days: r.validity_days,
  price_paisa: String(r.price_paisa),
  active: r.active,
});

/** Unique violation (partial index on active name) becomes a fixed sentence; nothing echoed. */
const mapUnique = (e: unknown): never => {
  if (e instanceof QueryFailedError && (e.driverError as { code?: string })?.code === '23505')
    throw new ConflictException(NAME_TAKEN);
  throw e;
};

/** [100.2.02] The owner's SMS package catalog. Edits never touch orders (they hold snapshots). */
@Injectable()
export class SmsBundleCatalogService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly audit: AuditService,
    private readonly home: PlatformHomeService,
  ) {}

  /** Owner view: active and off, newest first. */
  async listAll(limit = 25): Promise<SmsPackageDto[]> {
    const rows = await this.ds.getRepository(SmsBundleCatalog).find({
      order: { created_at: 'DESC', id: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map(toDto);
  }

  /** The one method the school route calls: active only, cheapest first. */
  async listActive(): Promise<SmsPackageDto[]> {
    const rows = await this.ds
      .getRepository(SmsBundleCatalog)
      .createQueryBuilder('c')
      .where('c.active = true')
      .orderBy('c.price_paisa', 'ASC')
      .addOrderBy('c.name', 'ASC')
      .addOrderBy('c.id', 'ASC')
      .getMany();
    return rows.map(toDto);
  }

  async create(dto: CreateSmsPackageDto, actor: CatalogActor): Promise<SmsPackageDto> {
    const tenantId = (await this.home.id()) ?? null;
    try {
      return await this.ds.transaction(async (em) => {
        const repo = em.getRepository(SmsBundleCatalog);
        const saved = await repo.save(
          repo.create({
            name: dto.name,
            sms_count: dto.smsCount,
            validity_days: dto.validityDays,
            price_paisa: String(toPaisa(dto.priceTaka)),
            active: true,
            created_by_user_id: actor.userId,
          }),
        );
        await this.audit.recordApproved(
          {
            action: AuditAction.SMS_BUNDLE_CREATED,
            entity_type: 'SmsBundleCatalog',
            entity_id: saved.id,
            tenant_id: tenantId,
            performed_by_user_id: actor.userId,
            ip_address: actor.ip ?? null,
            user_agent: actor.userAgent ?? null,
            new_values: snap(saved),
            approved_by_user_id: actor.approverId ?? actor.userId,
            approval_scope: ApprovalScope.PLATFORM_PLAN,
          },
          em,
        );
        return toDto(saved);
      });
    } catch (e) {
      return mapUnique(e);
    }
  }

  async update(id: string, dto: UpdateSmsPackageDto, actor: CatalogActor): Promise<SmsPackageDto> {
    // `@IsOptional()` lets an explicit null through; null would become a free package via toPaisa.
    if ((dto.priceTaka as unknown) === null) throw new BadRequestException('Price must be a number');
    const tenantId = (await this.home.id()) ?? null;
    try {
      return await this.ds.transaction(async (em) => {
        const repo = em.getRepository(SmsBundleCatalog);
        const row = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
        if (!row) throw new NotFoundException(NOT_FOUND);
        const before = snap(row);
        if (dto.name !== undefined) row.name = dto.name;
        if (dto.smsCount !== undefined) row.sms_count = dto.smsCount;
        if (dto.validityDays !== undefined) row.validity_days = dto.validityDays;
        if (dto.priceTaka !== undefined) row.price_paisa = String(toPaisa(dto.priceTaka));
        const saved = await repo.save(row);
        await this.audit.recordApproved(
          {
            action: AuditAction.SMS_BUNDLE_UPDATED,
            entity_type: 'SmsBundleCatalog',
            entity_id: id,
            tenant_id: tenantId,
            performed_by_user_id: actor.userId,
            ip_address: actor.ip ?? null,
            user_agent: actor.userAgent ?? null,
            old_values: before,
            new_values: snap(saved),
            approved_by_user_id: actor.approverId ?? actor.userId,
            approval_scope: ApprovalScope.PLATFORM_PLAN,
          },
          em,
        );
        return toDto(saved);
      });
    } catch (e) {
      return mapUnique(e);
    }
  }

  /** Idempotent: setting the state a row already has writes and audits nothing. */
  async setActive(id: string, active: boolean, actor: CatalogActor): Promise<SmsPackageDto> {
    const tenantId = (await this.home.id()) ?? null;
    try {
      return await this.ds.transaction(async (em) => {
        const repo = em.getRepository(SmsBundleCatalog);
        const row = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
        if (!row) throw new NotFoundException(NOT_FOUND);
        if (row.active === active) return toDto(row);
        row.active = active;
        const saved = await repo.save(row);
        await this.audit.record(
          {
            action: AuditAction.SMS_BUNDLE_TOGGLED,
            entity_type: 'SmsBundleCatalog',
            entity_id: id,
            tenant_id: tenantId,
            performed_by_user_id: actor.userId,
            ip_address: actor.ip ?? null,
            user_agent: actor.userAgent ?? null,
            old_values: { active: !active },
            new_values: { active },
          },
          em,
        );
        return toDto(saved);
      });
    } catch (e) {
      return mapUnique(e);
    }
  }
}
