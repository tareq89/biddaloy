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

ruleTester.run('no-radix-import', boundaryPlugin.rules['no-radix-import'], {
  valid: [
    "import { Placeholder } from '@biddaloy/ui/components';",
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
    "import { Placeholder } from '@biddaloy/ui/components';",
    "import { cn } from '@biddaloy/ui/utils';",
    "import { Button } from './primitives-catalog';",
    // An unrelated package or local folder that happens to be named
    // "primitives" isn't this boundary's concern — only @biddaloy/ui's
    // own tree is.
    "import { Button } from '@vendor/primitives/button';",
    "import { Button } from '../primitives/button';",
  ],
  invalid: [
    {
      code: "import { Button } from '@biddaloy/ui/src/primitives/button';",
      errors: [
        {
          messageId: 'deepImport',
          data: { source: '@biddaloy/ui/src/primitives/button' },
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
      code: "export { Button } from '@biddaloy/ui/src/primitives/button';",
      errors: [
        {
          messageId: 'deepImport',
          data: { source: '@biddaloy/ui/src/primitives/button' },
        },
      ],
    },
    {
      code: "export * from '@biddaloy/ui/src/primitives/button';",
      errors: [
        {
          messageId: 'deepImport',
          data: { source: '@biddaloy/ui/src/primitives/button' },
        },
      ],
    },
    {
      code: "import('@biddaloy/ui/src/primitives/button');",
      errors: [
        {
          messageId: 'deepImport',
          data: { source: '@biddaloy/ui/src/primitives/button' },
        },
      ],
    },
  ],
});

// Intl.NumberFormat/DateTimeFormat: no type info needed, plain parser is fine.
ruleTester.run('no-raw-intl (Intl constructors)', boundaryPlugin.rules['no-raw-intl'], {
  valid: [
    "import { formatCurrency } from '@biddaloy/ui/utils'; formatCurrency(100);",
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
