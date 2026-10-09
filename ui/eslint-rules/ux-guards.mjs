// [31.5.3] D37's four mechanically checkable UX rules, as one plugin so each
// rule gets its own id (own allow-list, own `eslint-disable-next-line` name)
// and the two config scopes (controls: all src; page: route/page files) can
// differ. All AST/text checks, no type info, so they run under ESLINT_FAST.
const CLASS_ATTRIBUTE_NAMES = new Set(['className', 'class']);
const TOKEN_RE = /[a-zA-Z0-9:_/.[\]%-]+/g;
const NATIVE_INPUT_TYPES = new Set(['date', 'time', 'month', 'week', 'datetime-local']);
const PAGE_MAX_W_RE = /^max-w-(md|lg|xl|[2-7]xl|screen-[a-z0-9]+|prose)$/;

const jsxName = (node) => (node.name.type === 'JSXIdentifier' ? node.name.name : null);

function literalAttr(opening, name) {
  const attr = opening.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === name);
  let v = attr?.value;
  if (v?.type === 'JSXExpressionContainer') v = v.expression;
  return v?.type === 'Literal' && typeof v.value === 'string' ? v.value : null;
}

const noNativePicker = {
  meta: {
    type: 'problem',
    docs: { description: 'No native select / date-time input (D25).' },
    schema: [],
    messages: {
      native:
        'Native `{{what}}` is banned (D25) — use `Select`/`Combobox`, or `DatePicker`/`MonthPicker`/`TimeInput` from `@biddaloy/ui/components`.',
    },
  },
  create: (context) => ({
    JSXOpeningElement(node) {
      const name = jsxName(node);
      if (name === 'select') {
        context.report({ node, messageId: 'native', data: { what: '<select>' } });
      } else if (name === 'input') {
        const type = literalAttr(node, 'type');
        if (type && NATIVE_INPUT_TYPES.has(type)) {
          context.report({ node, messageId: 'native', data: { what: `<input type="${type}">` } });
        }
      }
    },
  }),
};

const isCall = (n, prop) =>
  n?.type === 'CallExpression' &&
  n.callee.type === 'MemberExpression' &&
  !n.callee.computed &&
  n.callee.property.name === prop;

const noRawDateDisplay = {
  meta: {
    type: 'problem',
    docs: { description: 'No hand-rolled date display or ISO slicing (D5, D7).' },
    schema: [],
    messages: {
      raw: '`{{what}}` formats a date by hand (D5, D7) — use `formatDate`/`formatDateTime`/`formatTime` for screen text, `toIsoDate` from `@biddaloy/ui/utils` for API calls and URLs.',
    },
  },
  // ponytail: a Date held in a variable and shown via .toLocaleString() is not caught — needs type info; extend boundary/no-raw-intl's number check to Date if it shows up.
  create: (context) => ({
    CallExpression(node) {
      if (node.callee.type !== 'MemberExpression' || node.callee.computed) return;
      const prop = node.callee.property.name;
      const obj = node.callee.object;
      let what = null;
      if (prop === 'toLocaleDateString' || prop === 'toLocaleTimeString') what = `.${prop}()`;
      else if (
        prop === 'toLocaleString' &&
        obj.type === 'NewExpression' &&
        obj.callee.name === 'Date'
      )
        what = 'new Date().toLocaleString()';
      else if (
        ['slice', 'substring', 'substr', 'split'].includes(prop) &&
        isCall(obj, 'toISOString')
      )
        what = `.toISOString().${prop}()`;
      if (what) context.report({ node, messageId: 'raw', data: { what } });
    },
  }),
};

const noPageMaxWidth = {
  meta: {
    type: 'problem',
    docs: { description: 'No page-level max-w-* container widths (D15, D21).' },
    schema: [],
    messages: {
      width:
        '`{{token}}` sets a page width by hand (D15, D21) — page width comes from `PageContainer`, dialog width from the `Dialog` `size` prop.',
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (
          node.name.type !== 'JSXIdentifier' ||
          !CLASS_ATTRIBUTE_NAMES.has(node.name.name) ||
          !node.value
        )
          return;
        const sourceCode = context.sourceCode ?? context.getSourceCode();
        const text = sourceCode.getText(node.value);
        const base = node.value.range[0];
        for (const m of text.matchAll(TOKEN_RE)) {
          const token = m[0];
          if (!PAGE_MAX_W_RE.test(token.slice(token.lastIndexOf(':') + 1))) continue;
          const start = base + m.index;
          context.report({
            loc: {
              start: sourceCode.getLocFromIndex(start),
              end: sourceCode.getLocFromIndex(start + token.length),
            },
            messageId: 'width',
            data: { token },
          });
        }
      },
    };
  },
};

const rowActionsColumn = {
  meta: {
    type: 'problem',
    docs: { description: "A table column `id: 'actions'` must render <RowActions> (D19)." },
    schema: [],
    messages: {
      actions: 'Table action columns render `<RowActions>` from `@biddaloy/ui/components` (D19).',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    return {
      Property(node) {
        const { key, value, parent } = node;
        const isId = key.type === 'Identifier' ? key.name === 'id' : key.value === 'id';
        if (!isId || value.type !== 'Literal' || value.value !== 'actions') return;
        if (parent.type !== 'ObjectExpression') return;
        if (!sourceCode.getText(parent).includes('RowActions')) {
          context.report({ node, messageId: 'actions' });
        }
      },
    };
  },
};

export default {
  rules: {
    'no-native-picker': noNativePicker,
    'no-raw-date-display': noRawDateDisplay,
    'no-page-max-width': noPageMaxWidth,
    'row-actions-column': rowActionsColumn,
  },
};
