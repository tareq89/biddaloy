import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import ExcelJS from 'exceljs';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { AdmissionStageKind, AuditAction, ImportFileErrorCode } from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import { ImportStagingService } from '../bulk-import/import-staging.service';
import type { BulkImportErrorDto } from '../bulk-import/dto/bulk-import.dto';
import { ImportFileError } from '../../common/errors/import-file.error';
import {
  assertXlsxWithinLimits,
  XLSX_TOO_LARGE_MESSAGE,
  XlsxTooLargeError,
} from '../../common/utils/xlsx-guard.util';
import { lotteryAlreadyDrawn } from '../../common/filters/known-errors';
import { AdmissionStage } from './entities/admission-stage.entity';
import { AdmissionStageResult } from './entities/admission-stage-result.entity';
import { AdmissionStageResultService, type ResultActor } from './admission-stage-result.service';
import type {
  LotteryDrawResponseDto,
  LotteryImportCommitResponseDto,
  LotteryImportValidateResponseDto,
} from './dto/lottery.dto';

const MAX_ROWS = 2000;
const XLSX_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

interface StagedLottery {
  stage_id: string;
  ranks: { applicant_id: string; rank: number }[];
}

/**
 * Deterministic shuffle: index i of Fisher-Yates comes from sha256(seed:i), so the seed stored in
 * the audit row reproduces the order. The input is sorted first so only the seed decides.
 */
export function lotteryOrder(ids: string[], seed: string): string[] {
  const out = [...ids].sort();
  for (let i = out.length - 1; i > 0; i--) {
    const j = createHash('sha256').update(`${seed}:${i}`).digest().readUIntBE(0, 6) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const cell = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    const o = v as { text?: unknown; result?: unknown };
    if ('text' in o) return String(o.text ?? '').trim();
    if ('result' in o) return String(o.result ?? '').trim();
  }
  return String(v).trim();
};

/**
 * [71.G2.06, D15] A lottery stage is filled once: an in-app draw or an uploaded list. Both write
 * "points" = N - rank + 1 as the score (higher is better), so the merit order and cut-off of #4180
 * give rank 1 first. No Idempotency-Key (Rule 25): a second call is a 409, and a staging id is
 * consumed once.
 */
@Injectable()
export class AdmissionLotteryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly results: AdmissionStageResultService,
    private readonly staging: ImportStagingService,
    private readonly auditService: AuditService,
  ) {}

  /** Lock, check kind and emptiness, return who is in the stage. */
  private async open(manager: EntityManager, stageId: string, tenantId: string) {
    const stage = await this.results.lockStage(manager, stageId, tenantId);
    if (stage.kind !== AdmissionStageKind.LOTTERY)
      throw new BadRequestException('This stage is not a lottery');
    const [{ n }] = (await manager.query(
      `SELECT count(*)::int AS n FROM admission_stage_results
        WHERE tenant_id = $1 AND stage_id = $2 AND deleted_at IS NULL`,
      [tenantId, stage.id],
    )) as { n: number }[];
    if (n > 0) throw lotteryAlreadyDrawn();
    const members = await this.results.eligible(manager, stage, tenantId);
    if (members.length === 0) throw new BadRequestException('This stage has no applicants');
    return { stage, ids: members.map((m) => m.applicant_id) };
  }

  private async write(
    manager: EntityManager,
    stage: AdmissionStage,
    tenantId: string,
    actor: ResultActor,
    ranked: string[],
    audit: Record<string, unknown>,
  ) {
    const n = ranked.length;
    const repo = manager.getRepository(AdmissionStageResult);
    await repo.save(
      ranked.map((applicant_id, i) =>
        repo.create({
          tenant_id: tenantId,
          stage_id: stage.id,
          applicant_id,
          score: (n - i).toFixed(2),
          passed: null,
          remarks: null,
        }),
      ),
    );
    // Points run 1..N, so N is the scale the cut-off needs.
    await manager
      .getRepository(AdmissionStage)
      .update(
        { id: stage.id, tenant_id: tenantId },
        { config: { ...stage.config, total_marks: n } },
      );
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
        new_values: { stage_id: stage.id, count: n, ...audit },
      },
      manager,
    );
  }

  async draw(
    stageId: string,
    tenantId: string,
    actor: ResultActor,
  ): Promise<LotteryDrawResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const { stage, ids } = await this.open(manager, stageId, tenantId);
      const seed = randomBytes(16).toString('hex');
      await this.write(manager, stage, tenantId, actor, lotteryOrder(ids, seed), {
        op: 'LOTTERY_DRAW',
        seed,
      });
      return { drawn: ids.length };
    });
  }

  private async readSheet(file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('No file uploaded');
    const unreadable = () =>
      new ImportFileError(
        ImportFileErrorCode.UNREADABLE,
        'Could not read file — is it a valid Excel file?',
      );
    if (!file.originalname.toLowerCase().endsWith('.xlsx'))
      throw new ImportFileError(
        ImportFileErrorCode.UNSUPPORTED_TYPE,
        'Unsupported file type — upload .xlsx',
      );
    // matchesDeclaredType has no xlsx case; an xlsx is a zip, so check the zip signature.
    if (!file.buffer.subarray(0, 4).equals(XLSX_SIGNATURE)) throw unreadable();
    const workbook = new ExcelJS.Workbook();
    try {
      await assertXlsxWithinLimits(file.buffer);
      await workbook.xlsx.load(file.buffer as never);
    } catch (e) {
      throw e instanceof XlsxTooLargeError
        ? new ImportFileError(ImportFileErrorCode.TOO_LARGE, XLSX_TOO_LARGE_MESSAGE)
        : unreadable();
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw unreadable();
    const col = new Map<string, number>();
    sheet.getRow(1).eachCell({ includeEmpty: false }, (c, n) => col.set(cell(c.value), n));
    if (!col.has('rank') || (!col.has('reference_number') && !col.has('roll_number')))
      throw new ImportFileError(
        ImportFileErrorCode.MISSING_COLUMNS,
        'Missing required columns: rank and reference_number or roll_number',
      );
    const rows: { row: number; ref: string; roll: string; rank: string }[] = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
      const get = (h: string) =>
        col.has(h) ? cell(sheet.getRow(r).getCell(col.get(h)!).value) : '';
      const row = {
        row: r,
        ref: get('reference_number'),
        roll: get('roll_number'),
        rank: get('rank'),
      };
      if (row.ref || row.roll || row.rank) rows.push(row);
    }
    if (rows.length === 0)
      throw new ImportFileError(ImportFileErrorCode.NO_ROWS, 'File contains no data rows');
    if (rows.length > MAX_ROWS)
      throw new ImportFileError(ImportFileErrorCode.TOO_MANY_ROWS, 'File has too many rows');
    return rows;
  }

  async validate(
    stageId: string,
    file: Express.Multer.File | undefined,
    tenantId: string,
    userId: string,
  ): Promise<LotteryImportValidateResponseDto> {
    const rows = await this.readSheet(file);
    const { stage, ids } = await this.dataSource.transaction(async (m) => {
      // Read-only: the repeat check and the member list, no lock.
      const stage = await m.getRepository(AdmissionStage).findOne({
        where: { id: stageId, tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (!stage) throw new NotFoundException('Admission stage not found');
      if (stage.kind !== AdmissionStageKind.LOTTERY)
        throw new BadRequestException('This stage is not a lottery');
      const [{ n }] = (await m.query(
        `SELECT count(*)::int AS n FROM admission_stage_results
          WHERE tenant_id = $1 AND stage_id = $2 AND deleted_at IS NULL`,
        [tenantId, stage.id],
      )) as { n: number }[];
      if (n > 0) throw lotteryAlreadyDrawn();
      return {
        stage,
        ids: (await this.results.eligible(m, stage, tenantId)).map((c) => c.applicant_id),
      };
    });
    const people = (await this.dataSource.query(
      `SELECT id, reference_number, roll_number FROM admission_applicants
        WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, ids],
    )) as { id: string; reference_number: string; roll_number: string | null }[];
    const byRef = new Map(people.map((p) => [p.reference_number, p.id]));
    const byRoll = new Map(people.filter((p) => p.roll_number).map((p) => [p.roll_number!, p.id]));

    const errors: BulkImportErrorDto[] = [];
    const err = (row: number, column: string | null, code: string, message: string) =>
      errors.push({ row, column, severity: 'error', code, message });
    const seenPeople = new Set<string>();
    const seenRanks = new Set<number>();
    const ranks: StagedLottery['ranks'] = [];
    for (const r of rows) {
      const id = r.ref ? byRef.get(r.ref) : r.roll ? byRoll.get(r.roll) : undefined;
      const rank = /^\d{1,6}$/.test(r.rank) ? Number(r.rank) : null;
      let ok = true;
      if (!id) {
        err(
          r.row,
          r.ref ? 'reference_number' : 'roll_number',
          'UNKNOWN_APPLICANT',
          'This applicant is not in this stage',
        );
        ok = false;
      } else if (seenPeople.has(id)) {
        err(r.row, null, 'DUPLICATE_APPLICANT', 'This applicant appears more than once');
        ok = false;
      }
      if (rank === null || rank < 1 || rank > ids.length) {
        err(
          r.row,
          'rank',
          'INVALID_RANK',
          'Rank must be a whole number from 1 to the number of applicants',
        );
        ok = false;
      } else if (seenRanks.has(rank)) {
        err(r.row, 'rank', 'DUPLICATE_RANK', 'Two applicants have the same rank');
        ok = false;
      }
      if (id) seenPeople.add(id);
      if (rank !== null) seenRanks.add(rank);
      if (ok) ranks.push({ applicant_id: id!, rank: rank! });
    }
    const missing = ids.filter((id) => !seenPeople.has(id)).length;
    if (missing > 0)
      err(
        0,
        null,
        'MISSING_APPLICANTS',
        `${missing} applicant(s) in this stage are not in the file`,
      );

    if (errors.length > 0) return { staging_id: null, expires_at: null, rows: rows.length, errors };
    const { stagingId, expiresAt } = await this.staging.stage<StagedLottery>(tenantId, userId, {
      stage_id: stage.id,
      ranks,
    });
    return { staging_id: stagingId, expires_at: expiresAt, rows: rows.length, errors };
  }

  async commit(
    stageId: string,
    stagingId: string,
    tenantId: string,
    actor: ResultActor,
  ): Promise<LotteryImportCommitResponseDto> {
    const staged = await this.staging.consume<StagedLottery>(tenantId, actor.userId, stagingId);
    if (!staged || staged.stage_id !== stageId)
      throw new NotFoundException(
        'No staged upload found for this id. It may have expired or already been committed.',
      );
    return this.dataSource.transaction(async (manager) => {
      const { stage, ids } = await this.open(manager, stageId, tenantId);
      const inStage = new Set(ids);
      if (
        staged.ranks.length !== ids.length ||
        staged.ranks.some((r) => !inStage.has(r.applicant_id))
      )
        throw new BadRequestException('The list no longer matches this stage. Validate it again.');
      const ranked = [...staged.ranks].sort((a, b) => a.rank - b.rank).map((r) => r.applicant_id);
      await this.write(manager, stage, tenantId, actor, ranked, { op: 'LOTTERY_IMPORT' });
      return { imported: ranked.length };
    });
  }
}
