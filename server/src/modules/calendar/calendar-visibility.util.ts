import { SelectQueryBuilder } from 'typeorm';
import { CalendarAudience, UserRole } from '@biddaloy/shared';
import { CalendarEvent } from './entities/calendar-event.entity';

/**
 * What a caller may see, resolved once per request by
 * `CalendarEventsService.resolveViewer` and passed to `visibilityWhere`.
 *
 * `classIds` is the caller's own scope — for TEACHER, the classes they
 * teach a section of; for PARENT/STUDENT, the classes their linked
 * students are enrolled in. Staff roles that see everything (ADMIN,
 * EXECUTIVE, ACCOUNTANT) never need it populated.
 */
export interface CalendarViewer {
  role: string;
  userId: string;
  classIds: string[];
}

const UNRESTRICTED_ROLES: ReadonlySet<string> = new Set([
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.EXECUTIVE,
  UserRole.ACCOUNTANT,
]);

/**
 * The one definition of "which `CalendarEvent` rows can this viewer see",
 * applied via query builder so list and single-event reads share exactly
 * the same rule — a caller can never fetch by id what they couldn't have
 * found in the list.
 *
 * - ADMIN/EXECUTIVE/ACCOUNTANT: no filter — every event in the tenant.
 * - TEACHER: `audience IN (ALL, STAFF)`, OR the event is scoped to one of
 *   their classes via `CalendarEventClass`.
 * - PARENT/STUDENT: `audience = ALL`, OR the event is scoped to one of
 *   their linked students' classes. STAFF-audience events are never
 *   visible to family roles, regardless of class.
 *
 * `qb`'s root alias must be `'event'` — the `EXISTS` subqueries below
 * reference `calendar_event_classes` directly by table name rather than a
 * join, so no extra join is required from callers.
 */
export function visibilityWhere(
  qb: SelectQueryBuilder<CalendarEvent>,
  viewer: CalendarViewer,
): SelectQueryBuilder<CalendarEvent> {
  if (UNRESTRICTED_ROLES.has(viewer.role)) {
    return qb;
  }

  const classScopeExists = `EXISTS (
    SELECT 1 FROM calendar_event_classes cec
    WHERE cec.event_id = event.id AND cec.class_id IN (:...viewerClassIds)
  )`;

  // An event with no class links at all is scoped to "every class" — a
  // family member sees it as long as the audience matches, regardless of
  // their own class. An event *with* class links is only visible to a
  // family member whose class is one of them.
  const noClassScope = `NOT EXISTS (
    SELECT 1 FROM calendar_event_classes cec2
    WHERE cec2.event_id = event.id
  )`;

  if (viewer.role === UserRole.TEACHER) {
    if (viewer.classIds.length === 0) {
      return qb.andWhere('event.audience IN (:...teacherAudiences)', {
        teacherAudiences: [CalendarAudience.ALL, CalendarAudience.STAFF],
      });
    }
    return qb.andWhere(`(event.audience IN (:...teacherAudiences) OR ${classScopeExists})`, {
      teacherAudiences: [CalendarAudience.ALL, CalendarAudience.STAFF],
      viewerClassIds: viewer.classIds,
    });
  }

  if (viewer.role === UserRole.PARENT || viewer.role === UserRole.STUDENT) {
    // STAFF-audience events are never visible to family roles, regardless
    // of class scope — audience=ALL is required either way. Class links
    // only narrow *which* ALL-audience events a given family member sees.
    if (viewer.classIds.length === 0) {
      return qb.andWhere(`event.audience = :familyAudience AND ${noClassScope}`, {
        familyAudience: CalendarAudience.ALL,
      });
    }
    return qb.andWhere(
      `event.audience = :familyAudience AND (${noClassScope} OR ${classScopeExists})`,
      {
        familyAudience: CalendarAudience.ALL,
        viewerClassIds: viewer.classIds,
      },
    );
  }

  // Any other role reaching here has no defined visibility rule — fail
  // closed rather than leak every event in the tenant.
  return qb.andWhere('1 = 0');
}
