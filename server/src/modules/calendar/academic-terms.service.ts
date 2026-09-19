import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository, QueryFailedError } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';
import { AcademicTerm } from './entities/academic-term.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { CreateTermDto, UpdateTermDto, toTermResponseDto } from './dto/academic-terms.dto';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';

/** Postgres SQLSTATE for an exclusion-constraint violation — the migration's
 * `EXCLUDE USING gist (...)` on `academic_terms` fires this when a new/updated
 * term's date range overlaps another non-deleted term in the same year. */
const EXCLUSION_VIOLATION = '23P01';

/**
 * [17.2.2] `AcademicTerm` CRUD. The database owns the overlap rule (the
 * exclusion constraint on `academic_terms` — see the entity's docstring);
 * this service owns ordering (`seq`, dense after every delete/reorder) and
 * the "term must sit inside its academic year" range check, which the DB
 * has no constraint for since it needs a join against `academic_years`.
 */
@Injectable()
export class AcademicTermsService {
  constructor(
    @InjectRepository(AcademicTerm)
    private readonly repo: Repository<AcademicTerm>,
    @InjectRepository(AcademicYear)
    private readonly yearRepo: Repository<AcademicYear>,
    private readonly auditService: AuditService,
  ) {}

  async listByYear(tenantId: string, academicYearId: string): Promise<AcademicTerm[]> {
    return this.repo.find({
      where: { tenant_id: tenantId, academic_year_id: academicYearId, deleted_at: IsNull() },
      order: { seq: 'ASC' },
    });
  }

  private async findYearOrThrow(tenantId: string, academicYearId: string): Promise<AcademicYear> {
    const year = await this.yearRepo.findOne({
      where: { id: academicYearId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!year) {
      throw new NotFoundException(`Academic year "${academicYearId}" not found`);
    }
    return year;
  }

  /** `start_date`/`end_date` must both fall within `[year.start_date,
   * year.end_date]` (inclusive) or the write is refused with 422
   * `TERM_OUTSIDE_ACADEMIC_YEAR` — checked in the service since the DB has
   * no constraint spanning two tables. */
  private assertInsideYear(year: AcademicYear, startDate: string, endDate: string): void {
    const yearStart = toIso(year.start_date);
    const yearEnd = toIso(year.end_date);
    if (startDate < yearStart || endDate > yearEnd || startDate > endDate) {
      throw new UnprocessableEntityException({
        message: `Term dates must fall within the academic year (${yearStart} – ${yearEnd})`,
        details: { code: 'TERM_OUTSIDE_ACADEMIC_YEAR' },
      });
    }
  }

  /** Maps the exclusion constraint's SQLSTATE to a 422 naming the offending
   * term, instead of letting it surface as an opaque 500. */
  private mapOverlapError(err: unknown, name: string): never {
    if (
      err instanceof QueryFailedError &&
      (err as unknown as { code?: string }).code === EXCLUSION_VIOLATION
    ) {
      throw new UnprocessableEntityException({
        message: `"${name}" overlaps an existing term in this academic year`,
        details: { code: 'TERM_OVERLAP' },
      });
    }
    throw err;
  }

  async create(
    tenantId: string,
    dto: CreateTermDto,
    userId: string | null,
    context: RequestContext,
  ): Promise<AcademicTerm> {
    const year = await this.findYearOrThrow(tenantId, dto.academic_year_id);
    this.assertInsideYear(year, dto.start_date, dto.end_date);

    return this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(AcademicTerm);
      const existing = await repo.find({
        where: {
          tenant_id: tenantId,
          academic_year_id: dto.academic_year_id,
          deleted_at: IsNull(),
        },
      });
      const nextSeq = existing.reduce((max, term) => Math.max(max, term.seq), 0) + 1;

      const term = repo.create({
        tenant_id: tenantId,
        academic_year_id: dto.academic_year_id,
        seq: nextSeq,
        name: dto.name,
        start_date: dto.start_date,
        end_date: dto.end_date,
      });

      let saved: AcademicTerm;
      try {
        saved = await repo.save(term);
      } catch (err) {
        this.mapOverlapError(err, dto.name);
      }

      await this.auditService.record(
        {
          action: AuditAction.CREATE,
          entity_type: 'AcademicTerm',
          entity_id: saved.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: null,
          new_values: toTermResponseDto(saved) as unknown as Record<string, unknown>,
        },
        manager,
      );

      return saved;
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateTermDto,
    userId: string | null,
    context: RequestContext,
  ): Promise<AcademicTerm> {
    return this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(AcademicTerm);
      const existing = await repo.findOne({
        where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (!existing) {
        throw new NotFoundException(`Academic term "${id}" not found`);
      }

      const startDate = dto.start_date ?? existing.start_date;
      const endDate = dto.end_date ?? existing.end_date;
      if (dto.start_date || dto.end_date) {
        const year = await this.findYearOrThrow(tenantId, existing.academic_year_id);
        this.assertInsideYear(year, startDate, endDate);
      }

      const oldValues = toTermResponseDto(existing) as unknown as Record<string, unknown>;
      Object.assign(existing, {
        name: dto.name ?? existing.name,
        start_date: startDate,
        end_date: endDate,
      });

      let saved: AcademicTerm;
      try {
        saved = await repo.save(existing);
      } catch (err) {
        this.mapOverlapError(err, existing.name);
      }

      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'AcademicTerm',
          entity_id: saved.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: oldValues,
          new_values: toTermResponseDto(saved) as unknown as Record<string, unknown>,
        },
        manager,
      );

      return saved;
    });
  }

  /** Soft-deletes the term, then resequences the remaining non-deleted
   * terms in the year densely (1, 2, 3…) so a later `create` computing
   * `max(seq) + 1` never skips a gap the delete left behind. */
  async remove(
    tenantId: string,
    id: string,
    userId: string | null,
    context: RequestContext,
  ): Promise<void> {
    await this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(AcademicTerm);
      const existing = await repo.findOne({
        where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (!existing) {
        throw new NotFoundException(`Academic term "${id}" not found`);
      }

      await repo.softDelete({ id, tenant_id: tenantId });

      const remaining = await repo.find({
        where: {
          tenant_id: tenantId,
          academic_year_id: existing.academic_year_id,
          deleted_at: IsNull(),
        },
        order: { seq: 'ASC' },
      });
      for (let i = 0; i < remaining.length; i++) {
        const desiredSeq = i + 1;
        if (remaining[i].seq !== desiredSeq) {
          await repo.update({ id: remaining[i].id }, { seq: desiredSeq });
        }
      }

      await this.auditService.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'AcademicTerm',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: toTermResponseDto(existing) as unknown as Record<string, unknown>,
          new_values: null,
        },
        manager,
      );
    });
  }

  /** Rewrites `seq` densely to match the order of `ids` (1-indexed). Every
   * id must be a non-deleted term belonging to `academicYearId` in this
   * tenant, and the set of ids must exactly match the year's current terms
   * — otherwise the reorder is refused rather than silently partial. */
  async reorder(
    tenantId: string,
    academicYearId: string,
    ids: string[],
    userId: string | null,
    context: RequestContext,
  ): Promise<AcademicTerm[]> {
    return this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(AcademicTerm);
      const terms = await repo.find({
        where: { tenant_id: tenantId, academic_year_id: academicYearId, deleted_at: IsNull() },
      });

      // Explicit bound, checked before anything iterates `ids`: the DTO's
      // `@ArrayMaxSize` already rejects an oversized payload at the HTTP
      // boundary, but this guard keeps the loops below provably bounded by
      // a fixed constant regardless of what reaches this method directly.
      const MAX_REORDER_IDS = 100;
      if (ids.length > MAX_REORDER_IDS) {
        throw new UnprocessableEntityException({
          message: `ids must not exceed ${MAX_REORDER_IDS} entries`,
          details: { code: 'TERM_REORDER_TOO_LARGE' },
        });
      }

      const termIds = new Set(terms.map((t) => t.id));
      if (ids.length !== terms.length || !ids.every((id) => termIds.has(id))) {
        throw new UnprocessableEntityException({
          message: "ids must exactly match the academic year's current terms",
          details: { code: 'TERM_REORDER_MISMATCH' },
        });
      }

      // Two passes: the unique index on (academic_year_id, seq) is checked
      // per-statement, so writing final seq values directly can collide with
      // another term's current (not-yet-updated) seq. Stage negative,
      // guaranteed-unique offsets first, then assign the real values.
      for (let i = 0; i < ids.length; i++) {
        await repo.update({ id: ids[i] }, { seq: -(i + 1) });
      }
      for (let i = 0; i < ids.length; i++) {
        await repo.update({ id: ids[i] }, { seq: i + 1 });
      }

      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'AcademicTerm',
          entity_id: academicYearId,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { order: terms.sort((a, b) => a.seq - b.seq).map((t) => t.id) },
          new_values: { order: ids },
        },
        manager,
      );

      return repo.find({
        where: { tenant_id: tenantId, academic_year_id: academicYearId, deleted_at: IsNull() },
        order: { seq: 'ASC' },
      });
    });
  }
}

/** `AcademicYear.start_date`/`end_date` are typed `Date` on the entity but
 * stored as SQL `date` — normalizes either a `Date` or an already-`'YYYY-MM-DD'`
 * string into the ISO date string form so it compares correctly against
 * `AcademicTerm`'s own `string`-typed date columns. */
function toIso(value: Date | string): string {
  if (typeof value === 'string') return value;
  return value.toISOString().slice(0, 10);
}
