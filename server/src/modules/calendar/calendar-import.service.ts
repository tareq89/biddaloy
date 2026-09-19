import { BadRequestException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CalendarEvent } from './entities/calendar-event.entity';
import { CalendarEventClass } from './entities/calendar-event-class.entity';
import { Class } from '../academics/entities/class.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { CalendarEventsService } from './calendar-events.service';
import { SchoolsService } from '../schools/schools.service';
import { ImportStagingService } from '../bulk-import/import-staging.service';
import {
  buildCalendarImportCsvTemplate,
  buildCalendarImportXlsxTemplate,
  CalendarImportFileError,
  parseCalendarImportFile,
} from './import/calendar-import-file.util';
import { validateCalendarImportRow } from './import/calendar-import-rows.util';
import {
  CalendarImportRowResult,
  CalendarImportSummaryDto,
  ParsedCalendarImportRow,
  StagedCalendarImport,
  StagedCalendarImportRow,
} from './dto/calendar-import.dto';
import { CalendarImportRowStatus } from '@biddaloy/shared';
import { localToday } from '../attendance/attendance-policy.util';

export interface CalendarImportValidateResult {
  staging_id: string;
  expires_at: string;
  summary: CalendarImportSummaryDto;
  rows: Array<{
    row: number;
    status: CalendarImportRowStatus;
    errors: CalendarImportRowResult['errors'];
  }>;
}

export interface CalendarImportCommitResult {
  created: number;
  updated: number;
  unchanged: number;
  /** Rows that failed at commit time (e.g. a referenced class was deleted
   * after `validate` staged this row). `CalendarEventsService.create`/
   * `update` run one row at a time, not inside one DB transaction, so a
   * failure here does not roll back rows already written — re-uploading
   * the same file is safe though: already-committed rows resolve as
   * UNCHANGED/UPDATED on re-validate, never duplicated, and only the rows
   * listed here need fixing before the next commit. */
  failed: Array<{ row: number; message: string }>;
}

/**
 * [17.3.1] Turns an uploaded `.xlsx`/`.csv` into a row-by-row preview
 * (`validate`) an admin can review before anything is written, then applies
 * it exactly once (`commit`). Reuses `CalendarEventsService.create`/`update`
 * for the actual write — every past-lock/academic-year/attendance-guard
 * rule that service already enforces applies here unchanged, so this file
 * only owns: parsing the spreadsheet, resolving class names to ids, and
 * matching a row against an existing event by `(name, start_date)` to
 * decide `NEW`/`UPDATED`/`UNCHANGED`.
 */
const MAX_IMPORT_ROWS = 5000;

@Injectable()
export class CalendarImportService {
  constructor(
    @InjectRepository(CalendarEvent) private readonly eventRepo: Repository<CalendarEvent>,
    @InjectRepository(CalendarEventClass)
    private readonly eventClassRepo: Repository<CalendarEventClass>,
    @InjectRepository(Class) private readonly classRepo: Repository<Class>,
    @InjectRepository(AcademicYear) private readonly academicYearRepo: Repository<AcademicYear>,
    private readonly calendarEventsService: CalendarEventsService,
    private readonly schoolsService: SchoolsService,
    private readonly staging: ImportStagingService,
  ) {}

  async buildTemplate(format: 'xlsx' | 'csv'): Promise<{ buffer: Buffer; contentType: string }> {
    if (format === 'csv') {
      return {
        buffer: Buffer.from(buildCalendarImportCsvTemplate(), 'utf8'),
        contentType: 'text/csv; charset=utf-8',
      };
    }
    return {
      buffer: await buildCalendarImportXlsxTemplate(),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  private async getToday(tenantId: string): Promise<string> {
    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    const timezone = settings.region?.timezone ?? 'UTC';
    return localToday(timezone);
  }

  /** `Class` names are only unique per academic year — resolve the year
   * from the row's `start_date` before looking names up, same rule
   * `CalendarEventsService.resolveAcademicYear` enforces on write. */
  private async resolveAcademicYearId(tenantId: string, startDate: string): Promise<string | null> {
    const year = await this.academicYearRepo
      .createQueryBuilder('ay')
      .where('ay.tenant_id = :tenantId', { tenantId })
      .andWhere('ay.deleted_at IS NULL')
      .andWhere('ay.start_date <= :startDate', { startDate })
      .andWhere('ay.end_date >= :startDate', { startDate })
      .getOne();
    return year?.id ?? null;
  }

  private async resolveClassIds(
    tenantId: string,
    academicYearId: string | null,
    classNames: string[],
    rowNumber: number,
  ): Promise<{ classIds: string[]; errors: CalendarImportRowResult['errors'] }> {
    if (classNames.length === 0) return { classIds: [], errors: [] };
    if (!academicYearId) {
      return {
        classIds: [],
        errors: [
          {
            row: rowNumber,
            column: 'classes',
            message: 'This date range falls outside any academic year',
            severity: 'error',
          },
        ],
      };
    }

    const found = await this.classRepo
      .createQueryBuilder('class')
      .where('class.tenant_id = :tenantId', { tenantId })
      .andWhere('class.academic_year_id = :academicYearId', { academicYearId })
      .andWhere('class.name IN (:...names)', { names: classNames })
      .getMany();

    const foundNames = new Set(found.map((c) => c.name));
    const missing = classNames.filter((name) => !foundNames.has(name));
    if (missing.length > 0) {
      return {
        classIds: [],
        errors: [
          {
            row: rowNumber,
            column: 'classes',
            message: `Unknown class name(s) for this academic year: ${missing.join(', ')}`,
            severity: 'error',
          },
        ],
      };
    }
    return { classIds: found.map((c) => c.id), errors: [] };
  }

  /** Whether a matched existing event is identical to the parsed row —
   * decides `UPDATED` vs `UNCHANGED` so a re-run of the same file is a
   * no-op. */
  private isUnchanged(
    existing: CalendarEvent,
    existingClassIds: string[],
    row: ParsedCalendarImportRow,
    classIds: string[],
  ): boolean {
    const sameClassIds =
      existingClassIds.length === classIds.length &&
      new Set(existingClassIds).size === new Set(classIds).size &&
      classIds.every((id) => existingClassIds.includes(id));
    return (
      existing.type === row.type &&
      existing.end_date === row.end_date &&
      (existing.start_time ?? null) === row.start_time &&
      (existing.end_time ?? null) === row.end_time &&
      existing.counts_as_working_day === row.counts_as_working_day &&
      existing.audience === row.audience &&
      (existing.description ?? null) === row.description &&
      sameClassIds
    );
  }

  async validate(
    tenantId: string,
    userId: string,
    file: { buffer: Buffer; originalname: string },
  ): Promise<CalendarImportValidateResult> {
    let rawRows;
    try {
      rawRows = await parseCalendarImportFile(file.buffer, file.originalname);
    } catch (error) {
      if (error instanceof CalendarImportFileError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    // Explicit bound before anything iterates the parsed rows: the upload
    // is size-capped at the dropzone, but a pathological CSV can still pack
    // far more rows than any real school calendar needs into a small file.
    // Checked here, not just at the dropzone, so this stays provably bounded
    // no matter what calls validate() directly.
    if (rawRows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(
        `File has ${rawRows.length} rows; the maximum is ${MAX_IMPORT_ROWS}`,
      );
    }

    const today = await this.getToday(tenantId);
    const staged: StagedCalendarImportRow[] = [];
    // A (name, start_date) pair staged as NEW earlier in this same file —
    // the existing-event lookup below only queries the database, so two
    // rows sharing a (name, start_date) that both miss the database would
    // otherwise both stage as NEW and commit() would create two events
    // instead of the second one erroring or upserting against the first.
    const stagedNewKeys = new Set<string>();

    for (let i = 0; i < rawRows.length; i++) {
      const rowNumber = i + 2; // header is row 1
      const { row, errors } = validateCalendarImportRow(rawRows[i], rowNumber);

      if (!row) {
        staged.push({
          rowNumber,
          status: CalendarImportRowStatus.ERROR,
          errors,
          draft: null,
          existing_event_id: null,
        });
        continue;
      }

      if (row.end_date < today) {
        staged.push({
          rowNumber,
          status: CalendarImportRowStatus.ERROR,
          errors: [
            {
              row: rowNumber,
              column: 'end_date',
              message: 'This event has already ended and cannot be imported',
              severity: 'error',
              value: row.end_date,
            },
          ],
          draft: null,
          existing_event_id: null,
        });
        continue;
      }

      const academicYearId = await this.resolveAcademicYearId(tenantId, row.start_date);
      const { classIds, errors: classErrors } = await this.resolveClassIds(
        tenantId,
        academicYearId,
        row.class_names,
        rowNumber,
      );
      if (classErrors.length > 0) {
        staged.push({
          rowNumber,
          status: CalendarImportRowStatus.ERROR,
          errors: classErrors,
          draft: null,
          existing_event_id: null,
        });
        continue;
      }
      if (!academicYearId) {
        staged.push({
          rowNumber,
          status: CalendarImportRowStatus.ERROR,
          errors: [
            {
              row: rowNumber,
              column: 'start_date',
              message: 'This date range falls outside any academic year',
              severity: 'error',
              value: row.start_date,
            },
          ],
          draft: null,
          existing_event_id: null,
        });
        continue;
      }

      const dedupeKey = `${row.name} ${row.start_date}`;
      if (stagedNewKeys.has(dedupeKey)) {
        staged.push({
          rowNumber,
          status: CalendarImportRowStatus.ERROR,
          errors: [
            {
              row: rowNumber,
              column: 'name',
              message: 'Another row earlier in this file already has this name and start date',
              severity: 'error',
              value: row.name,
            },
          ],
          draft: null,
          existing_event_id: null,
        });
        continue;
      }

      const existing = await this.eventRepo
        .createQueryBuilder('event')
        .where('event.tenant_id = :tenantId', { tenantId })
        .andWhere('event.deleted_at IS NULL')
        .andWhere('event.name = :name', { name: row.name })
        .andWhere('event.start_date = :startDate', { startDate: row.start_date })
        .getOne();

      const draft = {
        type: row.type,
        name: row.name,
        start_date: row.start_date,
        end_date: row.end_date,
        start_time: row.start_time,
        end_time: row.end_time,
        counts_as_working_day: row.counts_as_working_day,
        audience: row.audience,
        class_ids: classIds,
        description: row.description,
      };

      if (!existing) {
        stagedNewKeys.add(dedupeKey);
        staged.push({
          rowNumber,
          status: CalendarImportRowStatus.NEW,
          errors: [],
          draft,
          existing_event_id: null,
        });
        continue;
      }

      const existingClassLinks = await this.eventClassRepo.find({
        where: { event_id: existing.id, tenant_id: tenantId },
      });
      const existingClassIds = existingClassLinks.map((link) => link.class_id);

      const status = this.isUnchanged(existing, existingClassIds, row, classIds)
        ? CalendarImportRowStatus.UNCHANGED
        : CalendarImportRowStatus.UPDATED;

      staged.push({ rowNumber, status, errors: [], draft, existing_event_id: existing.id });
    }

    const payload: StagedCalendarImport = { rows: staged };
    const { stagingId, expiresAt } = await this.staging.stage(tenantId, userId, payload);

    const summary: CalendarImportSummaryDto = {
      new: staged.filter((r) => r.status === CalendarImportRowStatus.NEW).length,
      updated: staged.filter((r) => r.status === CalendarImportRowStatus.UPDATED).length,
      unchanged: staged.filter((r) => r.status === CalendarImportRowStatus.UNCHANGED).length,
      error: staged.filter((r) => r.status === CalendarImportRowStatus.ERROR).length,
    };

    return {
      staging_id: stagingId,
      expires_at: expiresAt,
      summary,
      rows: staged.map((r) => ({ row: r.rowNumber, status: r.status, errors: r.errors })),
    };
  }

  async commit(
    tenantId: string,
    userId: string,
    stagingId: string,
    publish: boolean,
  ): Promise<CalendarImportCommitResult> {
    const staged = await this.staging.consume<StagedCalendarImport>(tenantId, userId, stagingId);
    if (!staged) {
      throw new UnprocessableEntityException({
        message: 'This import has expired or was already committed. Re-upload and validate again.',
        details: { code: 'CALENDAR_IMPORT_STAGING_EXPIRED' },
      });
    }

    if (staged.rows.some((r) => r.status === CalendarImportRowStatus.ERROR)) {
      throw new UnprocessableEntityException({
        message:
          'This import has row-level errors and cannot be committed. Fix them and re-validate.',
        details: { code: 'CALENDAR_IMPORT_HAS_ERRORS' },
      });
    }

    let created = 0;
    let updated = 0;
    let unchanged = 0;

    const failed: Array<{ row: number; message: string }> = [];

    for (const row of staged.rows) {
      if (!row.draft) continue; // unreachable given the guard above, keeps TS happy

      if (row.status === CalendarImportRowStatus.UNCHANGED) {
        unchanged += 1;
        continue;
      }

      try {
        if (row.status === CalendarImportRowStatus.NEW) {
          await this.calendarEventsService.create(
            {
              type: row.draft.type,
              name: row.draft.name,
              start_date: row.draft.start_date,
              end_date: row.draft.end_date,
              start_time: row.draft.start_time ?? undefined,
              end_time: row.draft.end_time ?? undefined,
              counts_as_working_day: row.draft.counts_as_working_day,
              audience: row.draft.audience,
              class_ids: row.draft.class_ids,
              description: row.draft.description ?? undefined,
              publish,
            },
            tenantId,
            userId,
          );
          created += 1;
          continue;
        }

        // UPDATED
        const updatedEvent = await this.calendarEventsService.update(
          row.existing_event_id as string,
          {
            type: row.draft.type,
            name: row.draft.name,
            start_date: row.draft.start_date,
            end_date: row.draft.end_date,
            start_time: row.draft.start_time,
            end_time: row.draft.end_time,
            counts_as_working_day: row.draft.counts_as_working_day,
            audience: row.draft.audience,
            class_ids: row.draft.class_ids,
            description: row.draft.description,
          },
          tenantId,
          userId,
        );
        // `update()` never touches `published_at` (only `create()`'s
        // `dto.publish` or the dedicated `publish()` method do) — apply the
        // commit-time `publish` flag explicitly so re-importing an updated
        // row with `publish: true` doesn't silently leave an existing draft
        // unpublished.
        if (publish && !updatedEvent.published_at) {
          await this.calendarEventsService.publish(
            row.existing_event_id as string,
            tenantId,
            userId,
          );
        }
        updated += 1;
      } catch (err) {
        // `create`/`update` run one row at a time, not inside one shared DB
        // transaction (CalendarEventsService has no manager-passthrough to
        // join one), so a mid-loop failure (e.g. a class referenced by this
        // row was deleted after `validate` staged it — assertClassesInTenant
        // re-checks this on every call) must not crash the whole commit and
        // strand the rows already written. Record it and keep going; the
        // staging entry is already consumed, but re-uploading the same file
        // is safe — already-committed rows resolve as UNCHANGED/UPDATED on
        // the next validate, never duplicated, so only the failed rows need
        // fixing before the next commit.
        failed.push({
          row: row.rowNumber,
          message: err instanceof Error ? err.message : 'Unknown error committing this row',
        });
      }
    }

    return { created, updated, unchanged, failed };
  }
}
