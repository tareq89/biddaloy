import { describe, expect, it } from 'vitest';

import {
  CalendarAudience,
  CalendarEventType,
  CalendarImportRowStatus,
  PublicHolidaySource,
  TermLabel,
} from './index';
import { AUDIT_ENTITY_TYPES } from '../audit/entity-types';

/**
 * Contract test for the Epic 17 calendar enums (#702). Locks each new enum
 * to exactly the member set the ticket specifies, and confirms the audit
 * catalog swap (SchoolHoliday -> CalendarEvent + friends) landed.
 */
describe('17.1.1 calendar enums + audit catalog [#702]', () => {
  it('CalendarEventType has exactly the 17.x member set', () => {
    expect(Object.values(CalendarEventType).sort()).toEqual(
      ['HOLIDAY', 'EXAM', 'EVENT', 'MEETING', 'DEADLINE'].sort(),
    );
  });

  it('CalendarAudience has exactly the 17.x member set', () => {
    expect(Object.values(CalendarAudience).sort()).toEqual(['ALL', 'STAFF'].sort());
  });

  it('TermLabel has exactly the 17.x member set', () => {
    expect(Object.values(TermLabel).sort()).toEqual(['TERM', 'SEMESTER', 'TRIMESTER'].sort());
  });

  it('PublicHolidaySource has exactly the 17.x member set', () => {
    expect(Object.values(PublicHolidaySource).sort()).toEqual(
      ['GOOGLE_ICS', 'NAGER_DATE', 'MANUAL'].sort(),
    );
  });

  it('CalendarImportRowStatus has exactly the 17.x member set', () => {
    expect(Object.values(CalendarImportRowStatus).sort()).toEqual(
      ['NEW', 'UPDATED', 'UNCHANGED', 'ERROR'].sort(),
    );
  });

  it('AUDIT_ENTITY_TYPES has the four new calendar names, and keeps SchoolHoliday read-compatible', () => {
    expect(AUDIT_ENTITY_TYPES).toEqual(
      expect.arrayContaining([
        'AcademicTerm',
        'CalendarEvent',
        'CalendarFeedToken',
        'PublicHolidaySet',
      ]),
    );
    // Deprecated, not removed: the school_holidays -> calendar_events
    // rename doesn't rewrite historical audit rows, so 'SchoolHoliday'
    // stays in the catalog as a read-compatible legacy value. No server
    // code writes it anymore (server/src/modules/audit/entity-catalog.spec.ts
    // has its own explicit exception for this one entry).
    expect(AUDIT_ENTITY_TYPES).toContain('SchoolHoliday');
  });
});
