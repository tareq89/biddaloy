// Custom ESLint rules enforcing the platform's central architectural rule:
// SPAs import UI exclusively from @beton-boi/ui's published subpaths, never
// Radix directly, never a deep `src/` or `primitives/` path, and never a raw
// `Intl`/`toLocaleString` call in place of a shared formatter. Registered
// only in client-* eslint configs — `ui` itself is never linted against
// these, since its own wrapper components are exactly the code that
// legitimately imports Radix and primitives.
import { ESLintUtils } from '@typescript-eslint/utils';
import ts from 'typescript';

// Matches both `@radix-ui/react-*` (the historical per-component packages)
// and the unscoped `radix-ui` package — the unified package Radix now ships,
// and what this repo actually depends on (see ui/package.json,
// ui/src/primitives/button.tsx's `import { Slot } from 'radix-ui'`). Only
// matching `@radix-ui/` would miss every real Radix import in this repo.
const RADIX_SOURCE = /^(radix-ui|@radix-ui\/.+)$/;

function pascalCase(str) {
  return str
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
}

/** Best-effort guess at the wrapped component's name, purely to make the
 * lint message point somewhere useful — not a claim that a wrapper by this
 * exact name exists yet. */
function suggestedName(source, importedName) {
  if (importedName && importedName !== 'default') return importedName;
  const match = /^@radix-ui\/react-(.+)$/.exec(source);
  if (match) return pascalCase(match[1]);
  return 'the component';
}

const noRadixImport = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow importing Radix directly; import the wrapped component from @beton-boi/ui/components instead.',
    },
    schema: [],
    messages: {
      radixDirect:
        'Import `{{name}}` from `@beton-boi/ui/components` instead of `{{source}}` directly.',
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (!RADIX_SOURCE.test(source)) return;

        if (node.specifiers.length === 0) {
          context.report({
            node,
            messageId: 'radixDirect',
            data: { name: suggestedName(source, null), source },
          });
          return;
        }

        for (const specifier of node.specifiers) {
          const importedName =
            specifier.type === 'ImportSpecifier' ? specifier.imported.name : null;
          context.report({
            node: specifier,
            messageId: 'radixDirect',
            data: { name: suggestedName(source, importedName), source },
          });
        }
      },
    };
  },
};

// The architectural contract is "published exports only" — these patterns
// are how that's currently detected, not the contract itself. Centralized
// here (rather than inlined in the visitor below) so a future internal
// folder (`internal/`, `generated/`, ...) is a one-line addition instead of
// a rule-logic change.
const DEEP_IMPORT_PATTERNS = [
  /^@beton-boi\/ui\/src(\/|$)/,
  /(^|\/)primitives\//,
  /(^|\/)primitives$/,
];

const noDeepUiImport = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow deep/primitive imports from @beton-boi/ui; import a published subpath export instead.',
    },
    schema: [],
    messages: {
      deepImport:
        'Import from a published `@beton-boi/ui` subpath (e.g. `@beton-boi/ui/components`) instead of `{{source}}`.',
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (DEEP_IMPORT_PATTERNS.some((pattern) => pattern.test(source))) {
          context.report({ node, messageId: 'deepImport', data: { source } });
        }
      },
    };
  },
};

// Only Intl constructors that actually have (or are explicitly documented as
// planned for) a shared wrapper in @beton-boi/ui/utils or /i18n — see that
// package's own barrel comments ("All currency, number, phone and date
// formatting lives here"). Intl.RelativeTimeFormat/ListFormat/Collator/
// PluralRules etc. have no such wrapper today; banning them would block
// legitimate code with a message pointing at a formatter that doesn't
// exist. Add to this list only once a wrapper actually lands.
const WRAPPED_INTL_CONSTRUCTORS = new Set(['NumberFormat', 'DateTimeFormat']);

const noRawIntl = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow calling Intl.NumberFormat/DateTimeFormat or a number’s toLocaleString directly; use the shared formatter from @beton-boi/ui/utils instead.',
    },
    schema: [],
    messages: {
      rawIntlNumberFormat:
        'Use `formatCurrency` (or another formatter) from `@beton-boi/ui/utils` instead of calling `Intl.NumberFormat` directly.',
      rawIntlDateTimeFormat:
        'Use a shared date formatter from `@beton-boi/ui/utils` or `@beton-boi/ui/i18n` instead of calling `Intl.DateTimeFormat` directly.',
      rawToLocaleString:
        'Use `formatCurrency` (or another formatter) from `@beton-boi/ui/utils` instead of a number’s `toLocaleString`.',
    },
  },
  create(context) {
    return {
      NewExpression(node) {
        const { callee } = node;
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'Intl' &&
          callee.property.type === 'Identifier' &&
          WRAPPED_INTL_CONSTRUCTORS.has(callee.property.name)
        ) {
          const messageId =
            callee.property.name === 'NumberFormat'
              ? 'rawIntlNumberFormat'
              : 'rawIntlDateTimeFormat';
          context.report({ node, messageId });
        }
      },
      CallExpression(node) {
        const { callee } = node;
        if (!(
          callee.type === 'MemberExpression' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'toLocaleString'
        )) {
          return;
        }

        // `toLocaleString` is a real method on Number, Date, Array and any
        // object choosing to implement it — a plain AST match on the
        // property name alone can't tell those apart, and Date/Array usage
        // is routinely intentional (a Date's toLocaleString often exists
        // precisely to carry timezone, and Array.prototype.toLocaleString
        // isn't a formatting concern at all). Only report when the type
        // checker confirms the receiver is actually a number — the one
        // case `formatCurrency` genuinely replaces. Falls back to not
        // reporting (never to reporting everything) if type info isn't
        // available, since a false negative here is far cheaper than the
        // false positives this replaced.
        const services = ESLintUtils.getParserServices(context, true);
        if (!services?.program) return;

        const type = services.getTypeAtLocation(callee.object);
        const isNumber = (type.flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) !== 0;
        if (isNumber) {
          context.report({ node, messageId: 'rawToLocaleString' });
        }
      },
    };
  },
};

export default {
  rules: {
    'no-radix-import': noRadixImport,
    'no-deep-ui-import': noDeepUiImport,
    'no-raw-intl': noRawIntl,
  },
};
