import { RuleTester } from 'eslint';

import logicalPropertiesPlugin from './logical-properties.mjs';

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run(
  'no-physical-direction-classes',
  logicalPropertiesPlugin.rules['no-physical-direction-classes'],
  {
    valid: [
      'const x = <div className="ms-2 me-4 ps-1 pe-3" />;',
      'const x = <div className="start-0 end-4 text-start text-end" />;',
      // Unrelated classes containing similar substrings must not false-positive.
      'const x = <div className="text-primary placeholder-text small" />;',
      'const x = <div className="mt-2 mb-4 pt-1 pb-3" />;',
      // Variant-prefixed logical utilities are fine.
      'const x = <div className="md:ms-2 hover:me-4 dark:ps-1" />;',
      // A non-class attribute with a similar-looking value is out of scope.
      'const x = <div data-direction="ml-2" />;',
      // classnames/cn() composition, already logical.
      "const x = <div className={cn('ms-2', active && 'me-4')} />;",
    ],
    invalid: [
      {
        code: 'const x = <div className="ml-2" />;',
        errors: [{ messageId: 'physicalClass', data: { token: 'ml-2', replacement: 'ms-2' } }],
      },
      {
        code: 'const x = <div className="mr-4" />;',
        errors: [{ messageId: 'physicalClass', data: { token: 'mr-4', replacement: 'me-4' } }],
      },
      {
        code: 'const x = <div className="pl-5" />;',
        errors: [{ messageId: 'physicalClass', data: { token: 'pl-5', replacement: 'ps-5' } }],
      },
      {
        code: 'const x = <div className="pr-3" />;',
        errors: [{ messageId: 'physicalClass', data: { token: 'pr-3', replacement: 'pe-3' } }],
      },
      {
        code: 'const x = <div className="left-0" />;',
        errors: [{ messageId: 'physicalClass', data: { token: 'left-0', replacement: 'start-0' } }],
      },
      {
        code: 'const x = <div className="right-4" />;',
        errors: [{ messageId: 'physicalClass', data: { token: 'right-4', replacement: 'end-4' } }],
      },
      {
        code: 'const x = <div className="text-left" />;',
        errors: [
          { messageId: 'physicalClass', data: { token: 'text-left', replacement: 'text-start' } },
        ],
      },
      {
        code: 'const x = <div className="text-right" />;',
        errors: [
          { messageId: 'physicalClass', data: { token: 'text-right', replacement: 'text-end' } },
        ],
      },
      {
        // A variant prefix on a physical utility is still caught, and the
        // replacement keeps the same variant.
        code: 'const x = <div className="md:ml-2" />;',
        errors: [
          { messageId: 'physicalClass', data: { token: 'md:ml-2', replacement: 'md:ms-2' } },
        ],
      },
      {
        // Inside cn()/clsx() composition, not just a bare literal.
        code: "const x = <div className={cn('p-2', active && 'ml-2')} />;",
        errors: [{ messageId: 'physicalClass', data: { token: 'ml-2', replacement: 'ms-2' } }],
      },
      {
        code: 'const x = <div class="mr-4" />;',
        errors: [{ messageId: 'physicalClass', data: { token: 'mr-4', replacement: 'me-4' } }],
      },
      {
        // Multiple violations in one attribute are each reported.
        code: 'const x = <div className="ml-2 mr-4" />;',
        errors: [
          { messageId: 'physicalClass', data: { token: 'ml-2', replacement: 'ms-2' } },
          { messageId: 'physicalClass', data: { token: 'mr-4', replacement: 'me-4' } },
        ],
      },
    ],
  },
);
