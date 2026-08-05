// Custom ESLint rules enforcing the platform's central architectural rule:
// SPAs import UI exclusively from @beton-boi/ui's published subpaths, never
// Radix directly, never a deep `src/` or `primitives/` path, and never a raw
// `Intl` call in place of a shared formatter. Registered only in client-*
// eslint configs — `ui` itself is never linted against these, since its own
// wrapper components are exactly the code that legitimately imports Radix
// and primitives.

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

const noRawIntl = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow calling Intl or toLocaleString directly; use a shared formatter from @beton-boi/ui/utils or @beton-boi/ui/i18n instead.',
    },
    schema: [],
    messages: {
      rawIntlNumberFormat:
        'Use `formatCurrency` (or another formatter) from `@beton-boi/ui/utils` instead of calling `Intl.NumberFormat` directly.',
      rawIntl:
        'Use a shared formatter from `@beton-boi/ui/utils` or `@beton-boi/ui/i18n` instead of calling `Intl.{{member}}` directly.',
      rawToLocaleString:
        'Use a shared formatter from `@beton-boi/ui/utils` (e.g. `formatCurrency`) instead of `toLocaleString`.',
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
          callee.property.type === 'Identifier'
        ) {
          const member = callee.property.name;
          if (member === 'NumberFormat') {
            context.report({ node, messageId: 'rawIntlNumberFormat' });
          } else {
            context.report({ node, messageId: 'rawIntl', data: { member } });
          }
        }
      },
      CallExpression(node) {
        const { callee } = node;
        if (
          callee.type === 'MemberExpression' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'toLocaleString'
        ) {
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
