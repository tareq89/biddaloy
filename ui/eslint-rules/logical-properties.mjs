// [8.7.6]: components use logical (inline-start/inline-end) Tailwind
// utilities, never physical left/right ones — `dir` is plumbed now (see
// `src/i18n/locale-provider.tsx`'s document-lang/dir sync) specifically so
// supporting an RTL locale later is a config change, not a layout rewrite.
// A single `ml-2` slipping into a component silently breaks that promise:
// it stays on the visual left even when `dir="rtl"` flips everything
// around it, and nothing short of a manual RTL screenshot catches it.
//
// Regex over each `className`/`class` attribute's raw source text, not an
// AST walk of the class list — a value built with `cn(...)`/`clsx(...)`,
// a ternary, and template interpolation has no single AST shape to walk
// uniformly, but every one of those still lexes into whitespace/quote-
// delimited class-name tokens the same way. Same pragmatic tradeoff as
// this repo's other hand-rolled checks (see `no-raw-intl` and
// `check-i18n-keys.mjs`'s own header comments).
const CLASS_ATTRIBUTE_NAMES = new Set(['className', 'class']);

// A Tailwind utility token, optionally prefixed by one or more
// `variant:` segments (`md:`, `hover:`, `dark:`, `rtl:`, ...) — the part
// after the last `:` is what actually names the utility.
const TOKEN_RE = /[a-zA-Z0-9:_/.[\]%-]+/g;

const PHYSICAL_SPACING_RE = /^(ml|mr|pl|pr)-(.+)$/;
const PHYSICAL_INSET_RE = /^(left|right)-(.+)$/;

const SPACING_REPLACEMENT = { ml: 'ms', mr: 'me', pl: 'ps', pr: 'pe' };
const INSET_REPLACEMENT = { left: 'start', right: 'end' };
const TEXT_ALIGN_REPLACEMENT = { 'text-left': 'text-start', 'text-right': 'text-end' };

/** The logical replacement for `token` (its own suffix/variants
 * preserved), or `null` if `token` isn't one of the physical-direction
 * utilities this rule bans. */
function logicalReplacement(token) {
  const lastColon = token.lastIndexOf(':');
  const variants = lastColon === -1 ? '' : token.slice(0, lastColon + 1);
  const utility = lastColon === -1 ? token : token.slice(lastColon + 1);

  if (TEXT_ALIGN_REPLACEMENT[utility]) {
    return variants + TEXT_ALIGN_REPLACEMENT[utility];
  }
  const spacingMatch = PHYSICAL_SPACING_RE.exec(utility);
  if (spacingMatch) {
    return `${variants}${SPACING_REPLACEMENT[spacingMatch[1]]}-${spacingMatch[2]}`;
  }
  const insetMatch = PHYSICAL_INSET_RE.exec(utility);
  if (insetMatch) {
    return `${variants}${INSET_REPLACEMENT[insetMatch[1]]}-${insetMatch[2]}`;
  }
  return null;
}

const noPhysicalDirectionClasses = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow physical-direction Tailwind utilities (ml-/mr-/pl-/pr-/left-/right-/text-left/text-right) in className; use the logical (inline-start/inline-end) equivalent instead.',
    },
    schema: [],
    messages: {
      physicalClass:
        '`{{token}}` is a physical-direction utility — use `{{replacement}}` instead, so layout survives an RTL locale.',
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        const attrName = node.name.type === 'JSXIdentifier' ? node.name.name : null;
        if (!attrName || !CLASS_ATTRIBUTE_NAMES.has(attrName) || !node.value) return;

        const sourceCode = context.sourceCode ?? context.getSourceCode();
        const valueText = sourceCode.getText(node.value);
        const valueStart = node.value.range[0];

        for (const match of valueText.matchAll(TOKEN_RE)) {
          const token = match[0];
          const replacement = logicalReplacement(token);
          if (!replacement) continue;

          const start = valueStart + match.index;
          context.report({
            loc: {
              start: sourceCode.getLocFromIndex(start),
              end: sourceCode.getLocFromIndex(start + token.length),
            },
            messageId: 'physicalClass',
            data: { token, replacement },
          });
        }
      },
    };
  },
};

export default {
  rules: {
    'no-physical-direction-classes': noPhysicalDirectionClasses,
  },
};
