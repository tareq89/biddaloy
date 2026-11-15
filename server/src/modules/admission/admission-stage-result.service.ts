import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { AdmissionApplicantStatus, AuditAction } from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import { AdmissionStage } from './entities/admission-stage.entity';
import { AdmissionStageResult } from './entities/admission-stage-result.entity';
import { AdmissionStageService } from './admission-stage.service';
import {
  DEFAULT_TIE_BREAK,
  TIE_BREAK_KEYS,
  meritOrder,
  toHundredths,
  type MeritRow,
  type TieBreakKey,
} from './admission-merit.util';
import {
  admissionResultsIncomplete,
  admissionStageNotScored,
} from '../../common/filters/known-errors';
import type {
  CutoffCommitDto,
  CutoffCommitResponseDto,
  CutoffMode,
  CutoffPreviewResponseDto,
  PutStageResultsDto,
  PutStageResultsResponseDto,
} from './dto/stage-result.dto';

/** No `attended` column exists (no migration in #4180): an absent applicant is a row with this remark. */
export const ABSENT_REMARK = 'ABSENT';
const INVALID_ROWS = 'The results are not valid for this stage';

export interface ResultActor {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface Candidate extends MeritRow {
  /** A row exists for this applicant in this stage. */
  recorded: boolean;
}

/**
 * [71.G2.05, D1, D22, D23] Results per stage, cut-off preview and commit.
 * Every write locks the round row first (the lock stage delete and kind change take), so a result
 * cannot slip in while a stage is being removed.
 */
@Injectable()
export class AdmissionStageResultService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly stageService: AdmissionStageService,
    private readonly auditService: AuditService,
  ) {}

  /** Locks the round, then re-reads the stage under the lock; 404 when it is not this tenant's. */
  async lockStage(
    manager: EntityManager,
    stageId: string,
    tenantId: string,
  ): Promise<AdmissionStage> {
    const repo = manager.getRepository(AdmissionStage);
    const where = { id: stageId, tenant_id: tenantId, deleted_at: IsNull() };
    const first = await repo.findOne({ where });
    if (!first) throw new NotFoundException('Admission stage not found');
    await this.stageService.lockIntake(manager, first.intake_id, tenantId);
    const stage = await repo.findOne({ where });
    if (!stage) throw new NotFoundException('Admission stage not found');
    return stage;
  }

  private totalHundredths(stage: AdmissionStage): number | null {
    const total = stage.config?.total_marks;
    return typeof total === 'number' || typeof total === 'string' ? toHundredths(total) : null;
  }

  private tieBreak(stage: AdmissionStage): readonly TieBreakKey[] {
    const configured = stage.config?.tie_break;
    if (
      Array.isArray(configured) &&
      configured.length > 0 &&
      configured.every((k) => TIE_BREAK_KEYS.includes(k as TieBreakKey))
    )
      return configured as TieBreakKey[];
    return DEFAULT_TIE_BREAK;
  }

  /**
   * Who is in this stage: not FEE_PENDING, and (unless it is the first real stage) passed the nearest
   * earlier stage that is not NONE. FEE_PENDING applicants are never eligible.
   */
  async eligible(
    manager: EntityManager,
    stage: AdmissionStage,
    tenantId: string,
  ): Promise<Candidate[]> {
    const [prev] = (await manager.query(
      `SELECT id FROM admission_stages
        WHERE tenant_id = $1 AND intake_id = $2 AND deleted_at IS NULL
          AND position < $3 AND kind <> 'NONE'
        ORDER BY position DESC LIMIT 1`,
      [tenantId, stage.intake_id, stage.position],
    )) as { id: string }[];
    const rows = (await manager.query(
      `SELECT a.id AS applicant_id, a.date_of_birth::text AS date_of_birth,
              to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS created_at,
              r.id IS NOT NULL AS recorded, r.score::text AS score
         FROM admission_applicants a
         LEFT JOIN admission_stage_results r
           ON r.applicant_id = a.id AND r.stage_id = $3 AND r.tenant_id = $1 AND r.deleted_at IS NULL
        WHERE a.tenant_id = $1 AND a.intake_id = $2 AND a.deleted_at IS NULL
          AND a.status <> $4
          AND ($5::uuid IS NULL OR EXISTS (
                SELECT 1 FROM admission_stage_results p
                 WHERE p.tenant_id = $1 AND p.stage_id = $5 AND p.applicant_id = a.id
                   AND p.passed = true AND p.deleted_at IS NULL))`,
      [tenantId, stage.intake_id, stage.id, AdmissionApplicantStatus.FEE_PENDING, prev?.id ?? null],
    )) as {
      applicant_id: string;
      date_of_birth: string;
      created_at: string;
      recorded: boolean;
      score: string | null;
    }[];
    return rows.map((r) => ({
      applicant_id: r.applicant_id,
      date_of_birth: r.date_of_birth,
      created_at: r.created_at,
      recorded: r.recorded,
      score_hundredths: toHundredths(r.score) ?? -1,
    }));
  }

  private async audit(
    manager: EntityManager,
    tenantId: string,
    actor: ResultActor,
    newValues: Record<string, unknown>,
  ) {
    await this.auditService.record(
      {
        action: AuditAction.UPDATE,
        entity_type: 'AdmissionApplicant',
        entity_id: null,
        tenant_id: tenantId,
        performed_by_user_id: actor.userId,
        ip_address: actor.ip,
        user_agent: actor.userAgent,
        old_values: null,
        new_values: newValues,
      },
      manager,
    );
  }

  /** Bulk upsert, last write wins. Cap 200 rows is the DTO's. */
  async putResults(
    stageId: string,
    dto: PutStageResultsDto,
    tenantId: string,
    actor: ResultActor,
  ): Promise<PutStageResultsResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const stage = await this.lockStage(manager, stageId, tenantId);
      const total = this.totalHundredths(stage);
      const inStage = new Set(
        (await this.eligible(manager, stage, tenantId)).map((c) => c.applicant_id),
      );
      const seen = new Set<string>();
      for (const row of dto.results) {
        if (seen.has(row.applicant_id) || !inStage.has(row.applicant_id))
          throw new BadRequestException(INVALID_ROWS);
        seen.add(row.applicant_id);
        const hasScore = row.score !== undefined && row.score !== null;
        const hasPassed = row.passed !== undefined && row.passed !== null;
        let ok: boolean;
        if (!row.attended) ok = !hasScore && !hasPassed;
        else if (total !== null) {
          const h = hasScore ? toHundredths(row.score) : null;
          ok = !hasPassed && h !== null && h >= 0 && h <= total;
        } else ok = hasPassed && !hasScore;
        if (!ok) throw new BadRequestException(INVALID_ROWS);
      }

      const repo = manager.getRepository(AdmissionStageResult);
      const existing = new Map(
        (
          await repo
            .createQueryBuilder('r')
            .where('r.tenant_id = :tenantId AND r.stage_id = :stageId AND r.deleted_at IS NULL', {
              tenantId,
              stageId: stage.id,
            })
            .getMany()
        ).map((r) => [r.applicant_id, r]),
      );
      const toSave = dto.results.map((row) => {
        const entity =
          existing.get(row.applicant_id) ??
          repo.create({ tenant_id: tenantId, stage_id: stage.id, applicant_id: row.applicant_id });
        entity.score =
          row.attended && total !== null ? (toHundredths(row.score)! / 100).toFixed(2) : null;
        // A score stage's `passed` is only set by cut-off commit; a new score voids an old commit.
        entity.passed = row.attended && total === null ? row.passed! : null;
        entity.remarks = row.attended ? null : ABSENT_REMARK;
        return entity;
      });
      await repo.save(toSave);
      await this.audit(manager, tenantId, actor, {
        op: 'STAGE_RESULTS_PUT',
        stage_id: stage.id,
        rows: toSave.length,
      });
      return { saved: toSave.length };
    });
  }

  private rank(stage: AdmissionStage, candidates: Candidate[]) {
    return meritOrder(
      candidates.filter((c) => c.recorded && c.score_hundredths >= 0),
      this.tieBreak(stage),
    );
  }

  private cutoff(
    stage: AdmissionStage,
    candidates: Candidate[],
    mode: CutoffMode,
    value: number,
  ): CutoffPreviewResponseDto {
    if (this.totalHundredths(stage) === null) throw admissionStageNotScored();
    const ranked = this.rank(stage, candidates);
    let passing: typeof ranked;
    if (mode === 'TOP_N') {
      if (!Number.isInteger(value)) throw new BadRequestException('The cut-off value is not valid');
      passing = ranked.slice(0, value);
    } else {
      const min = toHundredths(value);
      if (min === null) throw new BadRequestException('The cut-off value is not valid');
      passing = ranked.filter((r) => r.score_hundredths >= min);
    }
    const passIds = new Set(passing.map((r) => r.applicant_id));
    const boundary = passing.length ? passing[passing.length - 1].score_hundredths : null;
    const onBoundary =
      boundary === null ? [] : ranked.filter((r) => r.score_hundredths === boundary);
    return {
      passing: passing.map((r) => r.applicant_id),
      failing: candidates.map((c) => c.applicant_id).filter((id) => !passIds.has(id)),
      passing_count: passing.length,
      failing_count: candidates.length - passing.length,
      boundary_score: boundary === null ? null : boundary / 100,
      tied_at_boundary: onBoundary.some((r) => !passIds.has(r.applicant_id))
        ? onBoundary.length
        : 0,
    };
  }

  async preview(
    stageId: string,
    mode: CutoffMode,
    value: number,
    tenantId: string,
  ): Promise<CutoffPreviewResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      // Read-only, so no lock: it cannot change a row.
      const stage = await manager.getRepository(AdmissionStage).findOne({
        where: { id: stageId, tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (!stage) throw new NotFoundException('Admission stage not found');
      return this.cutoff(stage, await this.eligible(manager, stage, tenantId), mode, value);
    });
  }

  /**
   * Marks the cut-off's passers (plus `add`, minus `remove`) as passed; everyone else failed. No
   * Idempotency-Key (Rule 25): it sends and bills nothing, and the same body under the round lock
   * gives the same rows.
   */
  async commit(
    stageId: string,
    dto: CutoffCommitDto,
    tenantId: string,
    actor: ResultActor,
  ): Promise<CutoffCommitResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const stage = await this.lockStage(manager, stageId, tenantId);
      const candidates = await this.eligible(manager, stage, tenantId);
      const plan = this.cutoff(stage, candidates, dto.mode, dto.value);
      if (candidates.some((c) => !c.recorded)) throw admissionResultsIncomplete();
      const inStage = new Set(candidates.map((c) => c.applicant_id));
      const add = dto.add ?? [];
      const remove = dto.remove ?? [];
      if (
        [...add, ...remove].some((id) => !inStage.has(id)) ||
        add.some((id) => remove.includes(id))
      )
        throw new BadRequestException(INVALID_ROWS);
      const passed = new Set([...plan.passing, ...add]);
      for (const id of remove) passed.delete(id);

      await manager.query(
        `UPDATE admission_stage_results SET passed = (applicant_id = ANY($3::uuid[])), updated_at = now()
          WHERE tenant_id = $1 AND stage_id = $2 AND deleted_at IS NULL
            AND applicant_id = ANY($4::uuid[])`,
        [tenantId, stage.id, [...passed], [...inStage]],
      );
      await this.audit(manager, tenantId, actor, {
        op: 'STAGE_CUTOFF_COMMIT',
        stage_id: stage.id,
        mode: dto.mode,
        passed: passed.size,
        failed: inStage.size - passed.size,
        added: add.length,
        removed: remove.length,
      });
      return { passed: passed.size, failed: inStage.size - passed.size };
    });
  }
}
