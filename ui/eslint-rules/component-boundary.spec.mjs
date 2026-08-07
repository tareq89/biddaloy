import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';

import boundaryPlugin from './component-boundary.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

// `no-raw-intl`'s toLocaleString check needs real type information to tell
// a number from a Date/Array (see the rule's own comment) — a plain parser
// can't provide that, so this suite gets its own RuleTester wired to
// typescript-eslint's parser. `allowDefaultProject` builds a throwaway
// single-file program per test case instead of requiring an on-disk
// tsconfig/fixture file for each one.
const typedRuleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      projectService: {
        allowDefaultProject: ['*.ts'],
      },
      tsconfigRootDir: import.meta.dirname,
    },
  },
});

// `no-hardcoded-jsx-text` visits JSXText/JSXAttribute/JSXExpressionContainer
// nodes, which need `ecmaFeatures.jsx` on — none of the other rules in this
// file touch JSX syntax, so this is its own RuleTester rather than turned on
// for every case above.
const jsxRuleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('no-radix-import', boundaryPlugin.rules['no-radix-import'], {
  valid: [
    "import { Placeholder } from '@beton-boi/ui/components';",
    "import { Dialog } from './my-own-dialog';",
    "import radixLikeButNot from '@radix-ui-clone/button';",
  ],
  invalid: [
    {
      code: "import { Dialog } from 'radix-ui';",
      errors: [{ messageId: 'radixDirect', data: { name: 'Dialog', source: 'radix-ui' } }],
    },
    {
      code: "import Dialog from '@radix-ui/react-dialog';",
      errors: [
        { messageId: 'radixDirect', data: { name: 'Dialog', source: '@radix-ui/react-dialog' } },
      ],
    },
    {
      code: "import * as RadixTooltip from '@radix-ui/react-tooltip';",
      errors: [
        {
          messageId: 'radixDirect',
          data: { name: 'Tooltip', source: '@radix-ui/react-tooltip' },
        },
      ],
    },
    {
      // Side-effect-only import — no specifiers at all, still reported.
      code: "import '@radix-ui/react-dialog';",
      errors: [
        { messageId: 'radixDirect', data: { name: 'Dialog', source: '@radix-ui/react-dialog' } },
      ],
    },
    {
      // Named re-export — the consuming app still ends up with Radix in
      // its module graph, same as a direct import.
      code: "export { Dialog } from 'radix-ui';",
      errors: [{ messageId: 'radixDirect', data: { name: 'Dialog', source: 'radix-ui' } }],
    },
    {
      code: "export * from '@radix-ui/react-tooltip';",
      errors: [
        {
          messageId: 'radixDirect',
          data: { name: 'Tooltip', source: '@radix-ui/react-tooltip' },
        },
      ],
    },
    {
      code: "import('radix-ui');",
      errors: [{ messageId: 'radixDirect', data: { name: 'the component', source: 'radix-ui' } }],
    },
  ],
});

ruleTester.run('no-deep-ui-import', boundaryPlugin.rules['no-deep-ui-import'], {
  valid: [
    "import { Placeholder } from '@beton-boi/ui/components';",
    "import { cn } from '@beton-boi/ui/utils';",
    "import { Button } from './primitives-catalog';",
    // An unrelated package or local folder that happens to be named
    // "primitives" isn't this boundary's concern — only @beton-boi/ui's
    // own tree is.
    "import { Button } from '@vendor/primitives/button';",
    "import { Button } from '../primitives/button';",
  ],
  invalid: [
    {
      code: "import { Button } from '@beton-boi/ui/src/primitives/button';",
      errors: [
        {
          messageId: 'deepImport',
          data: { source: '@beton-boi/ui/src/primitives/button' },
        },
      ],
    },
    {
      code: "import { Button } from '../../ui/src/primitives/button';",
      errors: [
        {
          messageId: 'deepImport',
          data: { source: '../../ui/src/primitives/button' },
        },
      ],
    },
    {
      code: "export { Button } from '@beton-boi/ui/src/primitives/button';",
      errors: [
        {
          messageId: 'deepImport',
          data: { source: '@beton-boi/ui/src/primitives/button' },
        },
      ],
    },
    {
      code: "export * from '@beton-boi/ui/src/primitives/button';",
      errors: [
        {
          messageId: 'deepImport',
          data: { source: '@beton-boi/ui/src/primitives/button' },
        },
      ],
    },
    {
      code: "import('@beton-boi/ui/src/primitives/button');",
      errors: [
        {
          messageId: 'deepImport',
          data: { source: '@beton-boi/ui/src/primitives/button' },
        },
      ],
    },
  ],
});

// Intl.NumberFormat/DateTimeFormat: no type info needed, plain parser is fine.
ruleTester.run('no-raw-intl (Intl constructors)', boundaryPlugin.rules['no-raw-intl'], {
  valid: [
    "import { formatCurrency } from '@beton-boi/ui/utils'; formatCurrency(100);",
    // No wrapper exists for these today — must not be flagged (see the
    // rule's WRAPPED_INTL_CONSTRUCTORS comment).
    "const rtf = new Intl.RelativeTimeFormat('en-US');",
    "const lf = new Intl.ListFormat('en-US');",
    "const col = new Intl.Collator('en-US');",
    "const pr = new Intl.PluralRules('en-US');",
  ],
  invalid: [
    {
      code: "const fmt = new Intl.NumberFormat('en-US');",
      errors: [{ messageId: 'rawIntlNumberFormat' }],
    },
    {
      code: "const fmt = new Intl.DateTimeFormat('en-US');",
      errors: [{ messageId: 'rawIntlDateTimeFormat' }],
    },
    {
      // Callable without `new` — the spec still constructs a real
      // formatter instance (see the rule's checkIntlConstructor comment),
      // so this must be caught exactly like the `new` form.
      code: "const fmt = Intl.NumberFormat('en-US');",
      errors: [{ messageId: 'rawIntlNumberFormat' }],
    },
    {
      code: "const fmt = Intl.DateTimeFormat('en-US');",
      errors: [{ messageId: 'rawIntlDateTimeFormat' }],
    },
  ],
});

// toLocaleString: needs real type info to distinguish a number (flagged)
// from a Date/Array/anything else (not flagged) — see typedRuleTester above.
typedRuleTester.run('no-raw-intl (toLocaleString)', boundaryPlugin.rules['no-raw-intl'], {
  valid: [
    // Date: often intentional (locale + timezone) — never flagged.
    { code: 'const s: string = new Date().toLocaleString();', filename: 'file.ts' },
    // Array: not a formatting concern at all — never flagged.
    { code: 'const s: string = [1, 2, 3].toLocaleString();', filename: 'file.ts' },
    // Generic string method, unrelated — sanity check the rule doesn't
    // over-match on the property name in a non-toLocaleString call.
    { code: 'const s: string = String(100);', filename: 'file.ts' },
  ],
  invalid: [
    {
      code: 'const n: number = 1000; const s: string = n.toLocaleString();',
      filename: 'file.ts',
      errors: [{ messageId: 'rawToLocaleString' }],
    },
    {
      code: 'const s: string = (1000).toLocaleString();',
      filename: 'file.ts',
      errors: [{ messageId: 'rawToLocaleString' }],
    },
  ],
});

jsxRuleTester.run('no-hardcoded-jsx-text', boundaryPlugin.rules['no-hardcoded-jsx-text'], {
  valid: [
    // Already translated, or dynamic — the whole point of the rule.
    "const x = <p>{t('greeting')}</p>;",
    'const x = <p>{count}</p>;',
    'const x = <p>{`${count} items`}</p>;',
    // Whitespace-only JSX text (formatting between elements) — not content.
    'const x = <div>\n  <span />\n</div>;',
    // No letters — punctuation/digits/symbols don't need a translation key.
    'const x = <p>{"1,234"}</p>;',
    'const x = <p>×</p>;',
    'const x = <p>—</p>;',
    // Translated attribute values.
    "const x = <input aria-label={t('search')} />;",
    "const x = <input placeholder={t('search')} />;",
    // A dynamic (non-static) attribute expression — can't safely judge, so
    // left alone rather than false-flagged.
    'const x = <input aria-label={label} />;',
    // Attributes this rule doesn't police — never user-facing.
    'const x = <input data-testid="search-box" name="search" id="search" />;',
  ],
  invalid: [
    {
      code: 'const x = <p>Delete student</p>;',
      errors: [{ messageId: 'jsxText' }],
    },
    {
      // Bengali counts as translatable text too — the rule isn't
      // Latin-script-specific in either direction.
      code: 'const x = <p>শিক্ষার্থী মুছুন</p>;',
      errors: [{ messageId: 'jsxText' }],
    },
    {
      // A plain string in a `{}` container is exactly as hardcoded as bare
      // JSX text — just spelled differently.
      code: 'const x = <p>{"Delete student"}</p>;',
      errors: [{ messageId: 'jsxText' }],
    },
    {
      // A template literal with no interpolation — backticks don't make a
      // literal dynamic.
      code: 'const x = <p>{`Delete student`}</p>;',
      errors: [{ messageId: 'jsxText' }],
    },
    {
      code: 'const x = <input aria-label="Delete student" />;',
      errors: [{ messageId: 'jsxAttribute', data: { attr: 'aria-label' } }],
    },
    {
      code: 'const x = <input placeholder="Search" />;',
      errors: [{ messageId: 'jsxAttribute', data: { attr: 'placeholder' } }],
    },
    {
      code: 'const x = <div title="More information" />;',
      errors: [{ messageId: 'jsxAttribute', data: { attr: 'title' } }],
    },
    {
      code: 'const x = <img alt="Student photo" />;',
      errors: [{ messageId: 'jsxAttribute', data: { attr: 'alt' } }],
    },
    {
      // `{}`-wrapped literal attribute value — same violation, just spelled
      // with an unnecessary expression container.
      code: "const x = <input aria-label={'Delete student'} />;",
      errors: [{ messageId: 'jsxAttribute', data: { attr: 'aria-label' } }],
    },
    {
      code: 'const x = <input placeholder={`Search`} />;',
      errors: [{ messageId: 'jsxAttribute', data: { attr: 'placeholder' } }],
    },
  ],
});
