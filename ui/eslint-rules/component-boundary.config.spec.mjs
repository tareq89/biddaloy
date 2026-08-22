// Fixture-file coverage for the *wiring*, not just the rule logic —
// component-boundary.spec.mjs already exercises every rule in isolation via
// RuleTester, but that never touches the exported `componentBoundaryConfig`
// object or proves a client's real eslint.config.mjs actually adopts it (or
// that ui's doesn't). A refactor that silently drops the `boundary` plugin
// registration, renames a rule key, or removes the `files` scoping would
// pass every RuleTester case and still ship a config that lints nothing.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import clientAdminConfig from '../../client-admin/eslint.config.mjs';
import { componentBoundaryConfig } from '../eslint-config.mjs';
import uiConfig from '../eslint.config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Lints a fixture file's *contents* through the real, exported
 * `componentBoundaryConfig` — the same object `client-admin` imports and
 * spreads — via ESLint's actual `Linter`, not RuleTester. Skips
 * type-checked rules (recommendedTypeChecked isn't part of
 * componentBoundaryConfig itself) so no tsconfig/project wiring is needed;
 * `no-raw-intl`'s toLocaleString branch already degrades to "don't report"
 * without type services (see its own comment), so it's simply not exercised
 * here — component-boundary.spec.mjs's typedRuleTester suite covers it. */
async function lintFixture(code) {
  const eslint = new ESLint({
    cwd: here,
    overrideConfigFile: true,
    overrideConfig: [
      {
        languageOptions: {
          ecmaVersion: 2022,
          sourceType: 'module',
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
      },
      { files: ['**/*.tsx'], ...componentBoundaryConfig },
    ],
  });
  const [result] = await eslint.lintText(code, { filePath: 'fixture.tsx' });
  return result.messages;
}

describe('componentBoundaryConfig against fixture files', () => {
  it('flags a direct Radix import', async () => {
    const messages = await lintFixture("import { Dialog } from 'radix-ui';\n");
    expect(messages.map((m) => m.ruleId)).toContain('boundary/no-radix-import');
  });

  it('flags a deep @biddaloy/ui/src import', async () => {
    const messages = await lintFixture(
      "import { Button } from '@biddaloy/ui/src/primitives/button';\n",
    );
    expect(messages.map((m) => m.ruleId)).toContain('boundary/no-deep-ui-import');
  });

  it('flags a raw Intl.NumberFormat call', async () => {
    const messages = await lintFixture('const fmt = new Intl.NumberFormat("en-US");\n');
    expect(messages.map((m) => m.ruleId)).toContain('boundary/no-raw-intl');
  });

  it('flags hardcoded JSX text', async () => {
    const messages = await lintFixture('const x = <p>Delete student</p>;\n');
    expect(messages.map((m) => m.ruleId)).toContain('boundary/no-hardcoded-jsx-text');
  });

  it('flags a hardcoded aria-label', async () => {
    const messages = await lintFixture('const x = <input aria-label="Delete student" />;\n');
    expect(messages.map((m) => m.ruleId)).toContain('boundary/no-hardcoded-jsx-text');
  });

  it('passes a published @biddaloy/ui import clean', async () => {
    const messages = await lintFixture("import { Placeholder } from '@biddaloy/ui/components';\n");
    expect(messages.filter((m) => m.ruleId?.startsWith('boundary/'))).toEqual([]);
  });
});

describe('client config adoption and ui exemption', () => {
  function hasBoundaryPlugin(flatConfig) {
    return flatConfig.some((entry) => entry.plugins?.boundary != null);
  }

  it('client-admin adopts componentBoundaryConfig', () => {
    expect(hasBoundaryPlugin(clientAdminConfig)).toBe(true);
  });

  it('ui does not adopt componentBoundaryConfig (its wrappers legitimately import Radix and primitives)', () => {
    expect(hasBoundaryPlugin(uiConfig)).toBe(false);
  });
});
