import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import ExcelJS from 'exceljs';
import { CalendarEventType, CalendarImportRowStatus, toCsvContent } from '@biddaloy/shared';
import { CalendarEvent } from './entities/calendar-event.entity';
import { CalendarEventClass } from './entities/calendar-event-class.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { CalendarViewer, visibilityWhere } from './calendar-visibility.util';
import { ImportStagingService } from '../bulk-import/import-staging.service';
import {
  CALENDAR_IMPORT_COLUMNS,
  RawCalendarImportRow,
  validateCalendarImportRow,
} from './import/calendar-import-rows.util';
import {
  CalendarImportSummaryDto,
  StagedCalendarImport,
  StagedCalendarImportRow,
} from './dto/calendar-import.dto';

export interface CalendarExportFile {
  buffer: Buffer;
  contentType: string;
}

export interface CalendarCloneResult {
  staging_id: string;
  expires_at: string;
  summary: CalendarImportSummaryDto;
  rows: Array<{ row: number; status: CalendarImportRowStatus; errors: unknown[] }>;
  /** Source rows that shifted outside the target academic year and were
   * dropped rather than staged (e.g. an event near a year boundary). Not
   * an error — just not part of this clone. */
  dropped: number;
}

function toDateOnlyUtc(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function addDays(date: string, days: number): string {
  const d = toDateOnlyUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDays(from: string, to: string): number {
  const ms = toDateOnlyUtc(to).getTime() - toDateOnlyUtc(from).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

/**
 * [17.3.2] Two calendar-to-spreadsheet flows that both end up feeding
 * `CalendarImportService`'s existing preview/commit pipeline rather than
 * writing `CalendarEvent` rows directly:
 *
 * - `exportWorkbook`: today's calendar as a `.xlsx`/`.csv` download, using
 *   the exact `CALENDAR_IMPORT_COLUMNS` header the import template uses —
 *   so re-uploading an untouched export always validates as all
 *   `UNCHANGED` (D12).
 * - `cloneToYear`: builds the *same* row shape from next year's shifted
 *   dates and stages it via `ImportStagingService`, so "clone last year's
 *   calendar" is just a client calling `POST /calendar-import/commit`
 *   with the `staging_id` this returns — no separate commit path to keep
 *   in sync with past-lock/academic-year/attendance-guard rules.
 *
 * Row validation is `calendar-import-rows.util.ts`'s `validateCalendarImportRow`
 * — not re-implemented here, since a shifted row must satisfy exactly the
 * same shape rules an uploaded spreadsheet row does.
 */
@Injectable()
export class CalendarExportService {
  constructor(
    @InjectRepository(CalendarEvent) private readonly eventRepo: Repository<CalendarEvent>,
    @InjectRepository(CalendarEventClass)
    private readonly eventClassRepo: Repository<CalendarEventClass>,
    @InjectRepository(AcademicYear) private readonly academicYearRepo: Repository<AcademicYear>,
    @InjectRepository(Class) private readonly classRepo: Repository<Class>,
    private readonly staging: ImportStagingService,
  ) {}

  private async findYearOrThrow(tenantId: string, academicYearId: string): Promise<AcademicYear> {
    const year = await this.academicYearRepo.findOne({
      where: { id: academicYearId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!year) {
      throw new NotFoundException('Academic year not found');
    }
    return year;
  }

  /** `class_id[]` -> class `name[]`, tenant-scoped. Missing ids (e.g. a
   * class soft-deleted after the event was created) are silently
   * dropped from the export cell rather than failing the whole export —
   * a stale class reference isn't a reason to block reading the
   * calendar. */
  private async classNames(tenantId: string, classIds: string[]): Promise<string[]> {
    if (classIds.length === 0) return [];
    const found = await this.classRepo
      .createQueryBuilder('class')
      .where('class.tenant_id = :tenantId', { tenantId })
      .andWhere('class.id IN (:...ids)', { ids: classIds })
      .getMany();
    return found.map((c) => c.name);
  }

  private async eventClassIds(eventIds: string[]): Promise<Map<string, string[]>> {
    const byEvent = new Map<string, string[]>();
    if (eventIds.length === 0) return byEvent;
    const links = await this.eventClassRepo
      .createQueryBuilder('cec')
      .where('cec.event_id IN (:...ids)', { ids: eventIds })
      .getMany();
    for (const link of links) {
      const list = byEvent.get(link.event_id) ?? [];
      list.push(link.class_id);
      byEvent.set(link.event_id, list);
    }
    return byEvent;
  }

  private rowToCells(row: RawCalendarImportRow): string[] {
    return CALENDAR_IMPORT_COLUMNS.map((column) => row[column]);
  }

  private async buildRawRows(
    tenantId: string,
    academicYearId: string,
    viewer: CalendarViewer,
  ): Promise<RawCalendarImportRow[]> {
    const qb = this.eventRepo
      .createQueryBuilder('event')
      .where('event.tenant_id = :tenantId', { tenantId })
      .andWhere('event.deleted_at IS NULL')
      .andWhere('event.academic_year_id = :academicYearId', { academicYearId })
      .andWhere('event.published_at IS NOT NULL');
    visibilityWhere(qb, viewer);
    const events = await qb.orderBy('event.start_date', 'ASC').getMany();

    const classIdsByEvent = await this.eventClassIds(events.map((e) => e.id));
    const rows: RawCalendarImportRow[] = [];
    for (const event of events) {
      const classIds = classIdsByEvent.get(event.id) ?? [];
      const names = await this.classNames(tenantId, classIds);
      rows.push({
        type: event.type,
        name: event.name,
        start_date: event.start_date,
        end_date: event.end_date,
        start_time: event.start_time ?? '',
        end_time: event.end_time ?? '',
        counts_as_working_day: event.counts_as_working_day ? 'TRUE' : 'FALSE',
        audience: event.audience,
        classes: names.join(', '),
        description: event.description ?? '',
      });
    }
    return rows;
  }

  private async buildXlsx(rows: RawCalendarImportRow[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('calendar');
    sheet.addRow([...CALENDAR_IMPORT_COLUMNS]);
    for (const row of rows) {
      sheet.addRow(this.rowToCells(row));
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private buildCsv(rows: RawCalendarImportRow[]): string {
    return toCsvContent([[...CALENDAR_IMPORT_COLUMNS], ...rows.map((r) => this.rowToCells(r))]);
  }

  /** `GET /calendar/export` — [17.3.2] step 1. Same header order the
   * import template uses (`CALENDAR_IMPORT_COLUMNS`), so a plain
   * re-upload of the file this returns validates as all `UNCHANGED`. */
  async exportWorkbook(
    tenantId: string,
    academicYearId: string,
    format: 'xlsx' | 'csv',
    viewer: CalendarViewer,
  ): Promise<CalendarExportFile> {
    await this.findYearOrThrow(tenantId, academicYearId);
    const rows = await this.buildRawRows(tenantId, academicYearId, viewer);

    if (format === 'csv') {
      return {
        buffer: Buffer.from(this.buildCsv(rows), 'utf8'),
        contentType: 'text/csv; charset=utf-8',
      };
    }
    return {
      buffer: await this.buildXlsx(rows),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  /** `POST /calendar/clone` — [17.3.2] step 2. Selects non-`HOLIDAY`
   * published events from `source_year_id` (or the given `event_ids`,
   * still restricted to that year and rule), shifts every date by
   * `target.start_date - source.start_date` days, drops any row that
   * lands outside `target_year_id`'s own range, then stages the result
   * through the exact same path a spreadsheet upload does. The client
   * commits it via the existing `POST /calendar-import/commit`. */
  async cloneToYear(
    tenantId: string,
    userId: string,
    sourceYearId: string,
    targetYearId: string,
    eventIds: string[] | undefined,
  ): Promise<CalendarCloneResult> {
    const sourceYear = await this.findYearOrThrow(tenantId, sourceYearId);
    const targetYear = await this.findYearOrThrow(tenantId, targetYearId);

    const qb = this.eventRepo
      .createQueryBuilder('event')
      .where('event.tenant_id = :tenantId', { tenantId })
      .andWhere('event.deleted_at IS NULL')
      .andWhere('event.academic_year_id = :sourceYearId', { sourceYearId })
      .andWhere('event.published_at IS NOT NULL')
      .andWhere('event.type != :holiday', { holiday: CalendarEventType.HOLIDAY });
    if (eventIds && eventIds.length > 0) {
      qb.andWhere('event.id IN (:...eventIds)', { eventIds });
    }
    const sourceEvents = await qb.orderBy('event.start_date', 'ASC').getMany();

    if (eventIds && eventIds.length > 0) {
      const found = new Set(sourceEvents.map((e) => e.id));
      const missing = eventIds.filter((id) => !found.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          `event_ids not found in source year (or HOLIDAY/unpublished): ${missing.join(', ')}`,
        );
      }
    }

    const offsetDays = diffDays(String(sourceYear.start_date), String(targetYear.start_date));
    const classIdsByEvent = await this.eventClassIds(sourceEvents.map((e) => e.id));

    const staged: StagedCalendarImportRow[] = [];
    let dropped = 0;
    let rowNumber = 1;

    for (const event of sourceEvents) {
      rowNumber += 1;
      const shiftedStart = addDays(event.start_date, offsetDays);
      const shiftedEnd = addDays(event.end_date, offsetDays);

      if (
        shiftedStart < String(targetYear.start_date) ||
        shiftedEnd > String(targetYear.end_date)
      ) {
        dropped += 1;
        continue;
      }

      const classIds = classIdsByEvent.get(event.id) ?? [];
      const names = await this.classNames(tenantId, classIds);

      const raw: RawCalendarImportRow = {
        type: event.type,
        name: event.name,
        start_date: shiftedStart,
        end_date: shiftedEnd,
        start_time: event.start_time ?? '',
        end_time: event.end_time ?? '',
        counts_as_working_day: event.counts_as_working_day ? 'TRUE' : 'FALSE',
        audience: event.audience,
        classes: names.join(', '),
        description: event.description ?? '',
      };

      const { row, errors } = validateCalendarImportRow(raw, rowNumber);
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

      // `class_names` came straight from `Class.name` above, so a fresh
      // lookup in the *target* year resolves them to that year's own
      // class ids (classes are scoped per academic year, same rule
      // `CalendarEventsService.resolveAcademicYear` enforces on write).
      let targetClassIds: string[] = [];
      if (row.class_names.length > 0) {
        const targetClasses = await this.classRepo
          .createQueryBuilder('class')
          .where('class.tenant_id = :tenantId', { tenantId })
          .andWhere('class.academic_year_id = :targetYearId', { targetYearId })
          .andWhere('class.name IN (:...names)', { names: row.class_names })
          .getMany();

        // Same rule `CalendarImportService.resolveClassIds` enforces on
        // upload: a class name missing in the target year must stage an
        // ERROR row, not silently become `class_ids: []` — that would
        // clone an event restricted to specific classes as unrestricted,
        // widening who sees it in the new year.
        const foundNames = new Set(targetClasses.map((c) => c.name));
        const missingNames = row.class_names.filter((name) => !foundNames.has(name));
        if (missingNames.length > 0) {
          staged.push({
            rowNumber,
            status: CalendarImportRowStatus.ERROR,
            errors: [
              {
                row: rowNumber,
                column: 'classes',
                message: `Unknown class name(s) in target academic year: ${missingNames.join(', ')}`,
                severity: 'error',
              },
            ],
            draft: null,
            existing_event_id: null,
          });
          continue;
        }
        targetClassIds = targetClasses.map((c) => c.id);
      }

      const existing = await this.eventRepo
        .createQueryBuilder('e')
        .where('e.tenant_id = :tenantId', { tenantId })
        .andWhere('e.deleted_at IS NULL')
        // Scope by the *target* year, not just name+date — otherwise an
        // unrelated event in a different year sharing this name/date would
        // false-match here and get UPDATED instead of a fresh clone landing
        // as NEW in the target year.
        .andWhere('e.academic_year_id = :targetYearId', { targetYearId })
        .andWhere('e.name = :name', { name: row.name })
        .andWhere('e.start_date = :startDate', { startDate: row.start_date })
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
        class_ids: targetClassIds,
        description: row.description,
        // The row's dates were already validated against `targetYear`'s
        // bounds above (the `shiftedStart`/`shiftedEnd` drop check); pass
        // the year explicitly rather than letting `commit()` re-derive it
        // from dates alone, which can't disambiguate two academic years
        // whose ranges overlap.
        academic_year_id: targetYearId,
      };

      if (!existing) {
        staged.push({
          rowNumber,
          status: CalendarImportRowStatus.NEW,
          errors: [],
          draft,
          existing_event_id: null,
        });
        continue;
      }

      const existingLinks = await this.eventClassRepo.find({ where: { event_id: existing.id } });
      const existingClassIds = existingLinks.map((link) => link.class_id);
      const sameClassIds =
        existingClassIds.length === targetClassIds.length &&
        new Set(existingClassIds).size === new Set(targetClassIds).size &&
        targetClassIds.every((id) => existingClassIds.includes(id));
      const unchanged =
        existing.type === row.type &&
        existing.end_date === row.end_date &&
        (existing.start_time ?? null) === row.start_time &&
        (existing.end_time ?? null) === row.end_time &&
        existing.counts_as_working_day === row.counts_as_working_day &&
        existing.audience === row.audience &&
        (existing.description ?? null) === row.description &&
        sameClassIds;

      staged.push({
        rowNumber,
        status: unchanged ? CalendarImportRowStatus.UNCHANGED : CalendarImportRowStatus.UPDATED,
        errors: [],
        draft,
        existing_event_id: existing.id,
      });
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
      dropped,
    };
  }
}
