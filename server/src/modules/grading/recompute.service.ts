import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { ApprovalScope, AuditAction } from '@biddaloy/shared';
import { GradingScale } from './entities/grading-scale.entity';
import { GradingBand } from './entities/grading-band.entity';
import { AuditService } from '../audit/audit.service';
import { validateBands } from './band-validation';
import { BandInputDto, RecomputePreviewResult, toGradingBandDto } from './dto/grading.dto';
import { RequestContext } from '../../common/request-context.util';

/**
 * Recomputing results against a changed band set lives in the exams
 * module (`ExamResultRecomputer`), so this service depends on an
 * *interface*; `grading.module.ts` binds the real one to this token.
 */
export interface ResultRecomputer {
  /** How many results *would* change if this scale's bands became
   * `bands` — must not write anything. */
  countAffected(tenantId: string, scaleId: string, manager?: EntityManager): Promise<number>;
  /** Actually recompute every result graded against `scaleId`, inside the
   * caller's transaction (`manager`) so a failure here rolls back the
   * band change too. */
  recompute(
    tenantId: string,
    scaleId: string,
    manager: EntityManager,
    actor?: RecomputeActor,
  ): Promise<number>;
  /** Exams whose PUBLISHED results were graded against `scaleId` — a
   * scale edit is refused while any exist (D16). */
  findPublishedExams(
    tenantId: string,
    scaleId: string,
    manager?: EntityManager,
  ): Promise<Array<{ id: string; name: string }>>;
}

/** Who made the band edit, for the per-exam Result audit rows. */
export interface RecomputeActor {
  userId: string | null;
  context: RequestContext;
}

export const RESULT_RECOMPUTER = Symbol('RESULT_RECOMPUTER');

/**
 * [20.2.1, money-tier] Editing a scale's bands after results exist can
 * change GPAs — this is the only entry point that writes a band set.
 * `preview` computes what would change and writes nothing; `confirm` is
 * behind `@RequireApproval` at the controller and does the write, the
 * revision bump, the recompute, and the audit row in one transaction —
 * if the recompute step throws, the band change rolls back with it (D6).
 */
@Injectable()
export class RecomputeService {
  constructor(
    @InjectRepository(GradingScale)
    private readonly scaleRepo: Repository<GradingScale>,
    @InjectRepository(GradingBand)
    private readonly bandRepo: Repository<GradingBand>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    @Inject(RESULT_RECOMPUTER)
    private readonly resultRecomputer: ResultRecomputer,
  ) {}

  private async loadScale(id: string, tenantId: string): Promise<GradingScale> {
    const scale = await this.scaleRepo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!scale) throw new NotFoundException(`Grading scale "${id}" not found`);
    return scale;
  }

  private bandsEqual(current: GradingBand[], proposed: BandInputDto[]): boolean {
    if (current.length !== proposed.length) return false;
    const sortedCurrent = [...current].sort((a, b) => a.sequence - b.sequence);
    const sortedProposed = [...proposed].sort((a, b) => a.sequence - b.sequence);
    return sortedCurrent.every((band, i) => {
      const other = sortedProposed[i];
      return (
        band.percent_from === other.percent_from &&
        band.percent_to === other.percent_to &&
        band.grade === other.grade &&
        band.sequence === other.sequence &&
        (band.gpa === null ? null : Number(band.gpa)) === (other.gpa ?? null) &&
        band.is_fail === (other.is_fail ?? false) &&
        (band.comment ?? null) === (other.comment ?? null)
      );
    });
  }

  /** Writes nothing — validates the proposed set and reports what would
   * change (bands, and how many results). */
  async preview(
    scaleId: string,
    tenantId: string,
    bands: BandInputDto[],
  ): Promise<RecomputePreviewResult> {
    await this.loadScale(scaleId, tenantId);
    const problems = validateBands(bands);
    const current = await this.bandRepo.find({
      where: { scale_id: scaleId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    const bandsChanged = !this.bandsEqual(current, bands);

    // D16: the confirm would be refused with 409, so the preview says so now.
    if (problems.length === 0 && bandsChanged) {
      const published = await this.resultRecomputer.findPublishedExams(tenantId, scaleId);
      if (published.length > 0) {
        problems.push({
          type: 'SCALE_IN_PUBLISHED_RESULTS',
          message: `Published results use this grading scale: ${published.map((e) => e.name).join(', ')}. Reopen them first.`,
        });
      }
    }

    const affectedResultCount =
      problems.length === 0 && bandsChanged
        ? await this.resultRecomputer.countAffected(tenantId, scaleId)
        : 0;

    return {
      valid: problems.length === 0,
      problems,
      bands_changed: bandsChanged,
      affected_result_count: affectedResultCount,
    };
  }

  /** The approval-gated write: replaces the band set, bumps `revision` by
   * exactly one, recomputes affected results, and writes one audit row —
   * all in one transaction. Caller (controller) has already consumed the
   * approval token; `approverUserId` is who it was consumed for. */
  async confirm(
    scaleId: string,
    tenantId: string,
    userId: string,
    approverUserId: string,
    bands: BandInputDto[],
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<{ scale: GradingScale; bands: GradingBand[]; affected_result_count: number }> {
    const problems = validateBands(bands);
    if (problems.length > 0) {
      throw new BadRequestException({ message: 'Invalid band set', problems });
    }

    return this.dataSource.transaction(async (manager) => {
      const scale = await manager.getRepository(GradingScale).findOne({
        where: { id: scaleId, tenant_id: tenantId, deleted_at: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!scale) throw new NotFoundException(`Grading scale "${scaleId}" not found`);

      const bandRepo = manager.getRepository(GradingBand);
      // Capture the old band set (for the audit row) before it's replaced.
      const oldBands = await bandRepo.find({
        where: { scale_id: scaleId, tenant_id: tenantId, deleted_at: IsNull() },
      });
      // Replace the whole set (D-decision: not row-by-row patches) —
      // soft-delete the old rows so a past result graded against them can
      // still resolve the band that actually produced it, then insert the
      // new set fresh.
      await bandRepo.softDelete({ scale_id: scaleId, tenant_id: tenantId });
      const newBands = bandRepo.create(
        bands.map((band) => ({
          tenant_id: tenantId,
          scale_id: scaleId,
          percent_from: band.percent_from,
          percent_to: band.percent_to,
          grade: band.grade,
          gpa: band.gpa != null ? String(band.gpa) : null,
          is_fail: band.is_fail ?? false,
          sequence: band.sequence,
          comment: band.comment ?? null,
        })),
      );
      const savedBands = await bandRepo.save(newBands);

      const revisionBefore = scale.revision;
      scale.revision = scale.revision + 1;
      const savedScale = await manager.getRepository(GradingScale).save(scale);

      // Runs inside this same transaction (manager passed through) — a
      // throw here rolls back both the band replacement above and the
      // revision bump, per D6.
      const affectedResultCount = await this.resultRecomputer.recompute(
        tenantId,
        scaleId,
        manager,
        {
          userId,
          context,
        },
      );

      await this.auditService.recordApproved(
        {
          action: AuditAction.UPDATE,
          entity_type: 'GradingScale',
          entity_id: scaleId,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { revision: revisionBefore, bands: oldBands.map(toGradingBandDto) },
          new_values: {
            revision: savedScale.revision,
            bands: savedBands.map(toGradingBandDto),
            affected_result_count: affectedResultCount,
          },
          approved_by_user_id: approverUserId,
          approval_scope: ApprovalScope.GRADING_SCALE_MANAGE,
        },
        manager,
      );

      return { scale: savedScale, bands: savedBands, affected_result_count: affectedResultCount };
    });
  }
}
