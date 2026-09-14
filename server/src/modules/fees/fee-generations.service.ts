import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';
import { FeeGeneration } from './entities/fee-generation.entity';
import { AuditService } from '../audit/audit.service';
import {
  CollectionStatus,
  FeeGenerationBillItemDto,
  FeeGenerationListItemDto,
  QueryFeeGenerationBillsDto,
  QueryFeeGenerationsDto,
} from './dto/fee-generations.dto';

/** Fields `FeeGenerationsService.create` needs to write one batch row.
 * Callers (16.3.1's manual-generate flow, 16.7.2's scheduler) already have
 * the counts and snapshot by the time they call this — this service does
 * not run the generation itself, only logs it. */
export interface CreateFeeGenerationInput {
  tenant_id: string;
  academic_year_id: string;
  period_start: Date | string;
  period_type: FeeGeneration['period_type'];
  due_date: Date | string;
  source: FeeGeneration['source'];
  recurring_schedule_id?: string | null;
  generated_by_user_id?: string | null;
  approved_by_user_id?: string | null;
  duplicate_strategy: FeeGeneration['duplicate_strategy'];
  notify_families: boolean;
  structures: FeeGeneration['structures'];
  student_count: number;
  generated_count: number;
  skipped_count: number;
  removed_count: number;
}

export interface PageResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * `fee_generations` — the log behind every Generate press or schedule run.
 *
 * `create()` is the only write path, and it always takes the caller's
 * `EntityManager` so the log row commits (or rolls back) inside the same
 * transaction as the bills it describes. Everything else here is read-only:
 * the generation log page (16.1.4's own routes) and its drill-down.
 */
@Injectable()
export class FeeGenerationsService {
  constructor(
    @InjectRepository(FeeGeneration)
    private readonly repo: Repository<FeeGeneration>,
    private readonly auditService: AuditService,
  ) {}

  async create(input: CreateFeeGenerationInput, manager: EntityManager): Promise<FeeGeneration> {
    const repo = manager.getRepository(FeeGeneration);
    const saved = await repo.save(
      repo.create({
        tenant_id: input.tenant_id,
        academic_year_id: input.academic_year_id,
        period_start: input.period_start as Date,
        period_type: input.period_type,
        due_date: input.due_date as Date,
        source: input.source,
        recurring_schedule_id: input.recurring_schedule_id ?? null,
        generated_by_user_id: input.generated_by_user_id ?? null,
        approved_by_user_id: input.approved_by_user_id ?? null,
        duplicate_strategy: input.duplicate_strategy,
        notify_families: input.notify_families,
        structures: input.structures,
        student_count: input.student_count,
        generated_count: input.generated_count,
        skipped_count: input.skipped_count,
        removed_count: input.removed_count,
      }),
    );

    await this.auditService.record(
      {
        action: AuditAction.CREATE,
        entity_type: 'FeeGeneration',
        entity_id: saved.id,
        tenant_id: input.tenant_id,
        performed_by_user_id: input.generated_by_user_id ?? null,
        new_values: {
          source: input.source,
          academic_year_id: input.academic_year_id,
          period_start: input.period_start,
          student_count: input.student_count,
          generated_count: input.generated_count,
          skipped_count: input.skipped_count,
          removed_count: input.removed_count,
        },
      },
      manager,
    );

    return saved;
  }

  async findAll(
    query: QueryFeeGenerationsDto,
    tenantId: string,
  ): Promise<PageResult<FeeGenerationListItemDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.repo
      .createQueryBuilder('fg')
      .leftJoin('fg.generated_by', 'u')
      // One aggregate per batch, computed from student_fees rather than
      // N+1 per-row lookups — `bills.total_amount`/`paid_amount` are
      // decimal columns, so the sums come back as strings from pg and are
      // coerced with `Number(...)` below.
      .leftJoin('student_fees', 'sf', 'sf.fee_generation_id = fg.id AND sf.deleted_at IS NULL')
      .where('fg.tenant_id = :tenantId', { tenantId })
      .andWhere('fg.deleted_at IS NULL')
      .select('fg.id', 'id')
      .addSelect('fg.academic_year_id', 'academic_year_id')
      .addSelect('fg.period_start', 'period_start')
      .addSelect('fg.period_type', 'period_type')
      .addSelect('fg.due_date', 'due_date')
      .addSelect('fg.source', 'source')
      .addSelect('fg.duplicate_strategy', 'duplicate_strategy')
      .addSelect('fg.notify_families', 'notify_families')
      .addSelect('fg.student_count', 'student_count')
      .addSelect('fg.generated_count', 'generated_count')
      .addSelect('fg.skipped_count', 'skipped_count')
      .addSelect('fg.removed_count', 'removed_count')
      .addSelect('fg.structures', 'structures')
      .addSelect('fg.created_at', 'created_at')
      .addSelect('u.id', 'generated_by_id')
      .addSelect('u.full_name', 'generated_by_full_name')
      .addSelect('COALESCE(SUM(sf.total_amount), 0)', 'billed_amount')
      .addSelect('COALESCE(SUM(sf.paid_amount), 0)', 'collected_amount')
      .addSelect('COUNT(sf.id)', 'bill_count')
      .addSelect('COUNT(sf.id) FILTER (WHERE sf.paid_amount > 0)', 'paid_bill_count')
      .addSelect("COUNT(sf.id) FILTER (WHERE sf.status = 'PAID')", 'fully_paid_bill_count')
      .groupBy('fg.id')
      .addGroupBy('u.id')
      .orderBy('fg.created_at', 'DESC');

    if (query.period_from) {
      qb.andWhere('fg.period_start >= :periodFrom', { periodFrom: query.period_from });
    }
    if (query.period_to) {
      qb.andWhere('fg.period_start <= :periodTo', { periodTo: query.period_to });
    }
    if (query.source) {
      qb.andWhere('fg.source = :source', { source: query.source });
    }
    if (query.generated_by_user_id) {
      qb.andWhere('fg.generated_by_user_id = :generatedBy', {
        generatedBy: query.generated_by_user_id,
      });
    }
    if (query.fee_type) {
      // `structures` is a jsonb snapshot array — filter batches that
      // included at least one structure of this fee_type.
      qb.andWhere(`fg.structures @> :feeTypeFilter::jsonb`, {
        feeTypeFilter: JSON.stringify([{ fee_type: query.fee_type }]),
      });
    }

    // `collection_status` is derived from the same per-batch aggregates
    // used for `billed_amount`/`collected_amount` — it must be filtered
    // with a `HAVING` clause on those aggregates, not by post-filtering
    // the already-paginated `data[]` array. Filtering after `.offset/.limit`
    // would paginate the *unfiltered* set (so `total`/`totalPages` and the
    // actual filtered rows on a page disagree, and a real match past the
    // first page could be silently dropped).
    if (query.collection_status === 'NONE') {
      qb.andHaving('COUNT(sf.id) = 0 OR COUNT(sf.id) FILTER (WHERE sf.paid_amount > 0) = 0');
    } else if (query.collection_status === 'PARTIAL') {
      qb.andHaving(
        'COUNT(sf.id) > 0 AND COUNT(sf.id) FILTER (WHERE sf.paid_amount > 0) > 0 ' +
          "AND COUNT(sf.id) FILTER (WHERE sf.status = 'PAID') <> COUNT(sf.id)",
      );
    } else if (query.collection_status === 'FULL') {
      qb.andHaving(
        "COUNT(sf.id) > 0 AND COUNT(sf.id) FILTER (WHERE sf.status = 'PAID') = COUNT(sf.id)",
      );
    }

    // `getCount()` isn't used here: TypeORM keeps `GROUP BY` when building
    // a count query, which would return one row per batch (its bill count)
    // rather than the number of matching batches. Counting the (now
    // HAVING-filtered) grouped rows directly is correct, if not the
    // cheapest possible query — worth a `COUNT(DISTINCT ...)` subquery if
    // this page ever needs to scale past a school's realistic batch count.
    const totalRows = await qb.clone().getRawMany();
    const total = totalRows.length;

    qb.offset((page - 1) * limit).limit(limit);
    const rows = await qb.getRawMany();

    const data: FeeGenerationListItemDto[] = rows.map((r) => {
      const billCount = Number(r.bill_count);
      const paidBillCount = Number(r.paid_bill_count);
      const fullyPaidBillCount = Number(r.fully_paid_bill_count);
      let collection_status: CollectionStatus = 'NONE';
      if (billCount > 0) {
        if (fullyPaidBillCount === billCount) {
          collection_status = 'FULL';
        } else if (paidBillCount > 0) {
          collection_status = 'PARTIAL';
        }
      }

      return {
        id: r.id,
        academic_year_id: r.academic_year_id,
        period_start: r.period_start,
        period_type: r.period_type,
        due_date: r.due_date,
        source: r.source,
        duplicate_strategy: r.duplicate_strategy,
        notify_families: r.notify_families,
        student_count: Number(r.student_count),
        generated_count: Number(r.generated_count),
        skipped_count: Number(r.skipped_count),
        removed_count: Number(r.removed_count),
        structures: r.structures,
        created_at: r.created_at,
        billed_amount: Number(r.billed_amount),
        collected_amount: Number(r.collected_amount),
        collection_status,
        generated_by: r.generated_by_id
          ? { id: r.generated_by_id, full_name: r.generated_by_full_name }
          : null,
      };
    });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string): Promise<FeeGeneration> {
    const batch = await this.repo.findOne({
      where: { id, tenant_id: tenantId },
    });
    if (!batch) {
      throw new NotFoundException(`Fee generation batch "${id}" not found`);
    }
    return batch;
  }

  async findBills(
    id: string,
    query: QueryFeeGenerationBillsDto,
    tenantId: string,
  ): Promise<PageResult<FeeGenerationBillItemDto>> {
    // Confirms the batch belongs to this tenant before touching its bills —
    // a tenant-B caller must get 404, not an empty page.
    const batch = await this.findOne(id, tenantId);

    // `student_fees` (pre-16.4 rebuild) is still one aggregated row per
    // student per period, not one row per fee — it has no per-structure
    // link yet. Until that lands (16.4.x), `fee_name` falls back to the
    // batch's own structures snapshot: the single fee's name when the batch
    // only generated one, else a "N fees" summary.
    const fallbackFeeName =
      batch.structures.length === 1 ? batch.structures[0].name : `${batch.structures.length} fees`;

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.repo.manager
      .createQueryBuilder()
      .from('student_fees', 'sf')
      .innerJoin('students', 's', 's.id = sf.student_id')
      .leftJoin('class_sections', 'cs', 'cs.id = s.class_section_id')
      .leftJoin('classes', 'c', 'c.id = cs.class_id')
      .where('sf.fee_generation_id = :id', { id })
      .andWhere('sf.deleted_at IS NULL')
      .select('sf.id', 'id')
      .addSelect('sf.student_id', 'student_id')
      .addSelect('s.full_name', 'student_full_name')
      .addSelect('s.registration_number', 'student_registration_number')
      .addSelect('c.name', 'class_name')
      .addSelect('sf.total_amount', 'amount')
      .addSelect('sf.paid_amount', 'paid_amount')
      .addSelect('sf.status', 'status')
      .addSelect('sf.month', 'month')
      .addSelect('sf.year', 'year')
      .orderBy('s.full_name', 'ASC');

    const total = await qb.clone().getCount();
    qb.offset((page - 1) * limit).limit(limit);
    const rows = await qb.getRawMany();

    const data: FeeGenerationBillItemDto[] = rows.map((r) => ({
      id: r.id,
      student_id: r.student_id,
      student_full_name: r.student_full_name,
      student_registration_number: r.student_registration_number ?? null,
      class_name: r.class_name ?? null,
      fee_name: fallbackFeeName,
      amount: Number(r.amount),
      paid_amount: Number(r.paid_amount),
      status: r.status,
      occurrence: `${r.month}/${r.year}`,
    }));

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
