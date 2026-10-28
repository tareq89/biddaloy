import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ALL_TABS } from '../../modules/workbook/codec/registry';
import { writeWorkbook } from '../../modules/workbook/codec/workbook-codec';
import { SCHEMA_VERSION } from '../../modules/workbook/codec/meta';
import { branchRows, SCENARIOS, type BranchSpec } from './scenarios';

/**
 * Run: `yarn workspace @biddaloy/server ts-node src/scripts/guide-scenarios/build-workbooks.ts`
 * Writes every scenario workbook with the real codec writer. The codec's header
 * row is the column keys (identical in both languages), so the same file is
 * written to both guide language folders.
 */
export async function buildWorkbook(branch: BranchSpec, anchor: string): Promise<Buffer> {
  const rows = branchRows(branch, anchor);
  const tabs = ALL_TABS.filter((t) => t.name in rows);
  return writeWorkbook({
    tabs,
    meta: {
      schema_version: SCHEMA_VERSION,
      kind: 'TEMPLATE',
      exported_at: `${anchor}T00:00:00.000Z`,
      app_version: 'guide',
      source_school_name: `Demo ${branch.file}`,
      source_school_slug: branch.file,
    },
    rowsFor: async function* (tab) {
      yield* rows[tab.name];
    },
  });
}

export const todayAnchor = () => new Date().toISOString().slice(0, 10);

async function main() {
  const anchor = todayAnchor();
  const root = resolve(__dirname, '../../../../docs/user-guide');
  for (const lang of ['bn', 'en']) {
    mkdirSync(`${root}/${lang}/admin-setup/scenarios/files`, { recursive: true });
  }
  for (const branch of SCENARIOS.flatMap((s) => s.branches)) {
    const buf = await buildWorkbook(branch, anchor);
    for (const lang of ['bn', 'en']) {
      writeFileSync(`${root}/${lang}/admin-setup/scenarios/files/${branch.file}.xlsx`, buf);
    }
    console.log(`${branch.file}.xlsx ${buf.length} bytes`);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
