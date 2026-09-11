/**
 * Builds the checked-in `.xlsx` fixtures used by `import.controller.e2e-spec.ts`.
 *
 * Run with `npx ts-node test/fixtures/workbook/make-fixtures.ts` (from
 * `server/`) whenever the fixtures need regenerating — e.g. after a schema
 * bump. Not run automatically; the outputs below are committed so the e2e
 * suite doesn't need to regenerate them on every run.
 *
 * Only the `school` tab is used: at the time this ticket (#604) landed,
 * `ALL_TABS` contained just `school` (`academics`/`people`/`fees` tabs land
 * in later, still-in-flight lanes of epic 14.0). `three-errors.xlsx`
 * therefore demonstrates the three error kinds `school`'s own tab can
 * produce — a duplicate natural key (two rows) and an over-long column —
 * rather than the cross-tab scenarios (dangling section ref, bad enum,
 * duplicate registration number) the original ticket sketch assumed,
 * because those tabs don't exist yet. Once `students`/`sections` land, this
 * script should be updated to cover that richer scenario, and the fixtures
 * regenerated.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import {
  META_FIELDS,
  META_SHEET,
  SCHEMA_VERSION,
  type WorkbookMeta,
} from '../../../src/modules/workbook/codec/meta';
import { schoolTab } from '../../../src/modules/workbook/tabs/school/school.tab';
import { SEED_TENANT_ID } from '../../constants';

const OUT_DIR = __dirname;

function meta(): WorkbookMeta {
  return {
    schema_version: SCHEMA_VERSION,
    kind: 'BACKUP',
    exported_at: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    app_version: 'test-fixture',
    source_school_name: 'Test School',
    source_school_slug: 'test-school',
  };
}

function addMetaSheet(workbook: ExcelJS.Workbook, m: WorkbookMeta): void {
  const sheet = workbook.addWorksheet(META_SHEET);
  sheet.addRow(['key', 'value']);
  for (const field of META_FIELDS) sheet.addRow([field, m[field]]);
}

async function writeValid(): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  addMetaSheet(workbook, meta());

  const sheet = workbook.addWorksheet(schoolTab.name);
  sheet.addRow(schoolTab.columns.map((c) => c.key));
  sheet.addRow([SEED_TENANT_ID, 'Test School', '', '', '', '', '', '']);

  const buffer = await workbook.xlsx.writeBuffer();
  writeFileSync(join(OUT_DIR, 'valid.xlsx'), Buffer.from(buffer));
}

async function writeThreeErrors(): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  addMetaSheet(workbook, meta());

  const sheet = workbook.addWorksheet(schoolTab.name);
  sheet.addRow(schoolTab.columns.map((c) => c.key));
  // `id` is a required column on the `school` tab (there is exactly one row,
  // keyed to the destination tenant), so every row below reuses the seed
  // tenant's own id to avoid an unrelated "id is required" error crowding
  // out the three this fixture is meant to demonstrate.
  // Row 2 & 3: same `name` -> a duplicate-key error on each row (2 errors).
  sheet.addRow([SEED_TENANT_ID, 'Duplicate School', '', '', '', '', '', '']);
  sheet.addRow([SEED_TENANT_ID, 'Duplicate School', '', '', '', '', '', '']);
  // Row 4: `phone` over School's 20-char varchar bound -> 1 error.
  sheet.addRow([
    SEED_TENANT_ID,
    'Third School',
    '',
    '',
    '01700000000-way-too-long-for-the-column',
    '',
    '',
    '',
  ]);

  const buffer = await workbook.xlsx.writeBuffer();
  writeFileSync(join(OUT_DIR, 'three-errors.xlsx'), Buffer.from(buffer));
}

async function main(): Promise<void> {
  await writeValid();
  await writeThreeErrors();
  // eslint-disable-next-line no-console
  console.log('Wrote valid.xlsx and three-errors.xlsx to', OUT_DIR);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
