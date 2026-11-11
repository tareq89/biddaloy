import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { yearClosed } from '../filters/known-errors';

/**
 * [69.1.04] A closed academic year is read-only for every row with its `academic_year_id` (D4).
 * One query, no cache (D11): a close that just committed is seen by the next write.
 * Call it inside the write's transaction, before the write. `FOR SHARE` makes a concurrent
 * close (which takes the year row `FOR UPDATE`) wait until the write commits.
 */
export async function assertYearOpen(
  manager: EntityManager,
  tenantId: string,
  academicYearId: string,
): Promise<void> {
  const rows: Array<{ closed_at: Date | null }> = await manager.query(
    `SELECT closed_at FROM academic_years WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR SHARE`,
    [academicYearId, tenantId],
  );
  if (rows.length === 0) throw new NotFoundException('Academic year not found');
  if (rows[0].closed_at) throw yearClosed();
}

/**
 * For writes keyed by a date, not a year (attendance). Refuses when ANY closed year of the
 * tenant covers the date, even if an open year overlaps it (D12). `isoDate` is `YYYY-MM-DD`.
 */
export async function assertDateNotInClosedYear(
  manager: EntityManager,
  tenantId: string,
  isoDate: string,
): Promise<void> {
  const rows: Array<{ id: string }> = await manager.query(
    `SELECT id FROM academic_years
      WHERE tenant_id = $1 AND deleted_at IS NULL AND closed_at IS NOT NULL
        AND start_date <= $2::date AND end_date >= $2::date
      LIMIT 1`,
    [tenantId, isoDate],
  );
  if (rows.length > 0) throw yearClosed();
}

/**
 * One entry per entity with an `academic_year_id` column: the service and write methods that
 * must call `assertYearOpen` (D1, D11).
 * `server/test/year-open-guard-registry.integration.spec.ts` fails on an entity that is
 * missing here, and on a listed service file that never calls the guard.
 *
 * `AttendanceRecord` has no year column; it is keyed by date, so its guard is
 * `assertDateNotInClosedYear` (D12).
 */
export interface YearScopedWrite {
  entity: string;
  service: string;
  methods: string[];
}

const entry = (entity: string, service: string, methods: string[]): YearScopedWrite => ({
  entity,
  service,
  methods,
});

export const YEAR_SCOPED_WRITES: ReadonlyArray<YearScopedWrite> = [
  entry('Class', 'ClassService', ['create', 'update', 'remove']),
  entry('ClassSubject', 'SubjectService', ['updateClassSubject']),
  entry('AcademicTerm', 'AcademicTermsService', ['create', 'update', 'remove']),
  entry('CalendarEvent', 'CalendarEventsService', ['create', 'update', 'remove']),
  entry('Exam', 'ExamsService', ['create', 'update', 'remove']),
  entry('FeeGeneration', 'FeeGenerationsService', ['create']),
  entry('FeeStructure', 'FeeStructureService', ['create', 'update', 'remove']),
  entry('FineRule', 'FineRulesService', ['create', 'update', 'remove', 'copy']),
  entry('RecurringSchedule', 'RecurringSchedulesService', ['create', 'update', 'remove', 'clone']),
  entry('StudentFee', 'FeeGenerationsService', ['create']),
  entry('GradingScale', 'GradingService', ['create', 'update', 'remove', 'copy']),
  entry('PromotionRun', 'PromotionsService', ['create', 'remove']),
  entry('Routine', 'RoutineService', ['create']),
  entry('Enrollment', 'StudentService', ['create', 'update']),
  entry('StudentLifecycleEvent', 'StudentLifecycleService', ['recordEvent']),
  entry('StudentSubjectChoice', 'SubjectChoicesService', ['setChoice']),
  entry('StudyPlan', 'StudyPlansService', ['create', 'remove', 'copyToSection']),
  entry('AcrAssessment', 'AcrAssessmentsService', ['update']),
  entry('Application', 'ApplicationsService', ['submit', 'withdraw']),
  entry('FinalResult', 'FinalResultsService', ['create', 'update', 'remove', 'publish']),
  entry('AttendanceRecord', 'AttendanceService', [
    'putRegister',
    'putRegisterMatrix',
    'correctRecord',
    'markLeaveRange',
  ]),
];
