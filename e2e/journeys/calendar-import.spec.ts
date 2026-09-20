import { adminApiSession, get, post, postMultipart } from '../api';
import { shells } from '../config';
import { expect, test } from '../fixtures/test';

/**
 * [17.3.6] API-driven proof of the calendar spreadsheet import happy path
 * (17.3.1's `/calendar-import` controller): download the CSV template,
 * append one valid row, validate it (staging a preview without writing
 * anything), commit it published, then confirm the created event shows up
 * through `GET /calendar/events`.
 *
 * Pure API, no browser page — same shape as this file's sibling API
 * journeys use for their setup legs, just without a UI leg on top, since
 * the import flow itself has no dedicated screen yet (upload happens via
 * this same multipart endpoint from any client).
 */
test('calendar import: template -> validate -> commit -> event listed', async ({ playwright }) => {
  const request = await playwright.request.newContext({ baseURL: shells.app.baseURL });
  try {
    const admin = await adminApiSession(request);

    // 1. Download the CSV template — proves the endpoint itself works
    // before building a row by hand. The template is quoted/BOM-prefixed
    // (`buildCalendarImportCsvTemplate`), so this only checks column names
    // survive round-tripping, not exact byte formatting.
    const templateResponse = await request.get('/api/v1/calendar-import/template?format=csv', {
      headers: { Authorization: `Bearer ${admin.token}`, 'X-Tenant-ID': admin.tenantId },
    });
    expect(templateResponse.ok()).toBe(true);
    const templateCsv = await templateResponse.text();
    const templateHeader = templateCsv.replace(/^﻿/, '').trim().split(/\r?\n/)[0];
    for (const column of [
      'type',
      'name',
      'start_date',
      'end_date',
      'start_time',
      'end_time',
      'counts_as_working_day',
      'audience',
      'classes',
      'description',
    ]) {
      expect(templateHeader).toContain(column);
    }

    // Row order matches `CALENDAR_IMPORT_COLUMNS`
    // (`calendar-import-rows.util.ts`) — the parser is column-order
    // dependent, not header-name dependent.
    const header =
      'type,name,start_date,end_date,start_time,end_time,counts_as_working_day,audience,classes,description';

    // 2. One valid row, inside the seeded 2026 academic year
    // (`seed.util.ts`'s DEMO_ACADEMIC_YEAR) and in the future relative to
    // it, so neither the past-lock nor the academic-year-range check reject
    // it. Dates outside any academic year (e.g. a far future year with no
    // seeded row) fail `resolveAcademicYear` with a 422, not a NEW row.
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const eventName = `E2E Import Event ${suffix}`;
    const row = [
      'EVENT',
      eventName,
      '2026-12-15',
      '2026-12-15',
      '',
      '',
      'TRUE',
      'ALL',
      '',
      'Seeded by calendar-import.spec.ts',
    ].join(',');
    const csv = `${header}\n${row}\n`;

    // 3. Validate — stages the row, writes nothing yet.
    const validateResult = await postMultipart<{
      staging_id: string;
      summary: { new: number; updated: number; unchanged: number; error: number };
    }>(request, admin, '/calendar-import/validate', {
      name: 'calendar-import.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    });
    expect(validateResult.summary).toEqual({ new: 1, updated: 0, unchanged: 0, error: 0 });

    // 4. Commit, published, so it's immediately visible without needing
    // `include_drafts` on the read side.
    const commitResult = await post<{
      created: number;
      updated: number;
      unchanged: number;
      failed: { row: number; message: string }[];
    }>(request, admin, '/calendar-import/commit', {
      staging_id: validateResult.staging_id,
      publish: true,
    });
    expect(commitResult).toEqual({ created: 1, updated: 0, unchanged: 0, failed: [] });

    // 5. The event is listed for the range it falls in.
    const listing = await get<{ data: { id: string; name: string }[] }>(
      request,
      admin,
      '/calendar/events?from=2026-12-01&to=2026-12-31',
    );
    expect(listing.data.some((event) => event.name === eventName)).toBe(true);
  } finally {
    await request.dispose();
  }
});
