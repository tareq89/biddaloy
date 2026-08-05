import { RuleTester } from 'eslint';

import boundaryPlugin from './component-boundary.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
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
  ],
});

ruleTester.run('no-deep-ui-import', boundaryPlugin.rules['no-deep-ui-import'], {
  valid: [
    "import { Placeholder } from '@beton-boi/ui/components';",
    "import { cn } from '@beton-boi/ui/utils';",
    "import { Button } from './primitives-catalog';",
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
  ],
});

ruleTester.run('no-raw-intl', boundaryPlugin.rules['no-raw-intl'], {
  valid: [
    "import { formatCurrency } from '@beton-boi/ui/utils'; formatCurrency(100);",
    'const s = value.toString();',
  ],
  invalid: [
    {
      code: "const fmt = new Intl.NumberFormat('en-US');",
      errors: [{ messageId: 'rawIntlNumberFormat' }],
    },
    {
      code: "const fmt = new Intl.DateTimeFormat('en-US');",
      errors: [{ messageId: 'rawIntl', data: { member: 'DateTimeFormat' } }],
    },
    {
      code: 'const s = (1000).toLocaleString();',
      errors: [{ messageId: 'rawToLocaleString' }],
    },
  ],
});
