// Custom ESLint rules enforcing the platform's central architectural rule:
// SPAs import UI exclusively from @beton-boi/ui's published subpaths, never
// Radix directly, never a deep `src/` or `primitives/` path, never a raw
// `Intl`/`toLocaleString` call in place of a shared formatter, and never a
// hardcoded user-facing string in JSX or in aria-label/placeholder/title/alt
// where `t('...')` belongs instead ([8.7.4], extending [8.2.3]'s original
// three). Registered only in client-* eslint configs — `ui` itself is never
// linted against these, since its own wrapper components are exactly the
// code that legitimately imports Radix and primitives, and its wrapper
// layer is where translation keys originate rather than get consumed (see
// ui/CONTRIBUTING.md's "i18n rules" section).
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

/** A source module string only if `node` is a string-literal source — true
 * for every static `from '...'` clause, and for `import('...')` with a
 * literal argument. A computed dynamic import (`import(pathVar)`) has no
 * statically knowable source, so it's out of reach for any AST-only rule. */
function literalSource(node) {
  return node && node.type === 'Literal' && typeof node.value === 'string' ? node.value : null;
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
    function report(node, source, importedName) {
      context.report({
        node,
        messageId: 'radixDirect',
        data: { name: suggestedName(source, importedName), source },
      });
    }

    /** Shared by `import`/`export ... from` — both carry a `source` and a
     * `specifiers` array, just with different specifier node shapes. */
    function checkSpecifiers(node, source, specifiers, getImportedName) {
      if (!RADIX_SOURCE.test(source)) return;
      if (specifiers.length === 0) {
        report(node, source, null);
        return;
      }
      for (const specifier of specifiers) {
        report(specifier, source, getImportedName(specifier));
      }
    }

    return {
      ImportDeclaration(node) {
        checkSpecifiers(node, node.source.value, node.specifiers, (s) =>
          s.type === 'ImportSpecifier' ? s.imported.name : null,
        );
      },
      // `export { Dialog } from 'radix-ui'` / `export { Dialog as default }
      // from 'radix-ui'` — re-exports the boundary should catch exactly
      // like a direct import, since the consuming app still ends up with
      // Radix in its module graph. A same-file `export { x }` with no
      // `source` isn't a re-export at all and is out of scope.
      ExportNamedDeclaration(node) {
        if (!node.source) return;
        checkSpecifiers(node, node.source.value, node.specifiers, (s) => s.local.name);
      },
      // `export * from 'radix-ui'` — no specifiers to name, so the message
      // falls back to "the component".
      ExportAllDeclaration(node) {
        if (!RADIX_SOURCE.test(node.source.value)) return;
        report(node, node.source.value, null);
      },
      // `import('radix-ui')` — dynamic, no specifiers either.
      ImportExpression(node) {
        const source = literalSource(node.source);
        if (source && RADIX_SOURCE.test(source)) {
          report(node, source, null);
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
//
// Scoped specifically to `@beton-boi/ui`'s own tree, not a bare
// `primitives`/`src` segment anywhere in a path — an unrelated package like
// `@vendor/primitives/button` (or a client's own local `./primitives-catalog`)
// is not this boundary's concern, and a broader match would false-positive
// on it.
const DEEP_IMPORT_PATTERNS = [/^@beton-boi\/ui\/src(\/|$)/, /(^|\/)ui\/src\/primitives(\/|$)/];

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
    function check(node, source) {
      if (DEEP_IMPORT_PATTERNS.some((pattern) => pattern.test(source))) {
        context.report({ node, messageId: 'deepImport', data: { source } });
      }
    }

    return {
      ImportDeclaration(node) {
        check(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source) check(node, node.source.value);
      },
      ExportAllDeclaration(node) {
        check(node, node.source.value);
      },
      ImportExpression(node) {
        const source = literalSource(node.source);
        if (source) check(node, source);
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

/** True (and reports) for `Intl.NumberFormat(...)`/`Intl.DateTimeFormat(...)`
 * — matches both `new Intl.NumberFormat()` and the callable-without-`new`
 * form, since the spec makes both construct a real formatter instance
 * (https://tc39.es/ecma402/#sec-intl.numberformat, "NewTarget is undefined"
 * branch), so a bare `Intl.NumberFormat(...)` bypasses this boundary just
 * as much as the `new` form does. */
function checkIntlConstructor(context, node, callee) {
  if (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'Intl' &&
    callee.property.type === 'Identifier' &&
    WRAPPED_INTL_CONSTRUCTORS.has(callee.property.name)
  ) {
    const messageId =
      callee.property.name === 'NumberFormat' ? 'rawIntlNumberFormat' : 'rawIntlDateTimeFormat';
    context.report({ node, messageId });
    return true;
  }
  return false;
}

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
        checkIntlConstructor(context, node, node.callee);
      },
      CallExpression(node) {
        const { callee } = node;
        if (checkIntlConstructor(context, node, callee)) return;

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

// Attributes that reach a user (sighted or via assistive tech) exactly the
// same way JSX text content does — the issue's own framing: "a developer
// who cannot write bare JSX text will happily write `aria-label="Delete
// student"` or `placeholder="Search"`, both of which reach users, and one
// of which reaches screen-reader users exclusively." Deliberately narrow
// (not every string prop — `data-testid`, `name`, `id` etc. are never
// user-facing) rather than an allowlist that inevitably drifts.
const TRANSLATABLE_ATTRIBUTES = new Set(['aria-label', 'placeholder', 'title', 'alt']);

// A lone symbol, digit, or punctuation run ("×", "1", "—", "/") isn't text
// that needs a translation key — requiring one would just train developers
// to silence the rule instead of trusting it. Unicode-aware so this isn't
// itself accidentally Latin-script-only.
const LETTER_PATTERN = /\p{L}/u;

function needsTranslation(text) {
  return LETTER_PATTERN.test(text.trim());
}

function isStringLiteral(node) {
  return node.type === 'Literal' && typeof node.value === 'string';
}

/** A template literal with zero interpolations (`` `Delete student` ``) is
 * exactly as hardcoded as a plain string literal — the backticks don't
 * make it dynamic. One *with* an interpolation is left alone: it's either
 * already composing a `t()` call's result or something too dynamic for
 * this AST-only rule to safely judge either way. */
function isStaticTemplateLiteral(node) {
  return node.type === 'TemplateLiteral' && node.expressions.length === 0;
}

/** The literal text `node` evaluates to, or `null` if `node` isn't one of
 * the two static-text shapes this rule understands. */
function staticText(node) {
  if (isStringLiteral(node)) return node.value;
  if (isStaticTemplateLiteral(node)) return node.quasis.map((q) => q.value.cooked).join('');
  return null;
}

const noHardcodedJsxText = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Disallow a hardcoded user-facing string as JSX text or in an aria-label/placeholder/title/alt attribute; use t('...') from @beton-boi/ui/i18n instead.",
    },
    schema: [],
    messages: {
      jsxText: "Wrap user-facing text in t('...') (from @beton-boi/ui/i18n) instead of a literal.",
      jsxAttribute:
        "`{{attr}}` reaches users the same way JSX text does — wrap it in t('...') instead of a literal.",
    },
  },
  create(context) {
    return {
      JSXText(node) {
        const text = node.value.trim();
        if (text && needsTranslation(text)) {
          context.report({ node, messageId: 'jsxText' });
        }
      },
      // Only a `{...}` container that's itself a JSX *child* — the same
      // container shape wrapping an attribute value (`aria-label={'x'}`) is
      // a child of JSXAttribute, not of JSXElement/JSXFragment, and is
      // handled by the JSXAttribute visitor below so it isn't reported
      // twice under two different messages.
      JSXExpressionContainer(node) {
        if (node.parent.type !== 'JSXElement' && node.parent.type !== 'JSXFragment') return;
        const text = staticText(node.expression);
        if (text !== null && needsTranslation(text)) {
          context.report({ node, messageId: 'jsxText' });
        }
      },
      JSXAttribute(node) {
        const attrName = node.name.type === 'JSXIdentifier' ? node.name.name : null;
        if (!attrName || !TRANSLATABLE_ATTRIBUTES.has(attrName) || !node.value) return;

        const text = isStringLiteral(node.value)
          ? node.value.value
          : node.value.type === 'JSXExpressionContainer'
            ? staticText(node.value.expression)
            : null;

        if (text !== null && needsTranslation(text)) {
          context.report({ node: node.value, messageId: 'jsxAttribute', data: { attr: attrName } });
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
    'no-hardcoded-jsx-text': noHardcodedJsxText,
  },
};
