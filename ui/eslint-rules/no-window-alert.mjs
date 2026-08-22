// [8.9.8]'s "no window.alert anywhere" AC. Native alert/confirm/prompt
// can't be styled, localized, or announced consistently with the rest of
// the shell — this codebase has a dedicated replacement for each case:
// `toast()` (`ui/src/components/toast.tsx`) for fire-and-forget feedback,
// `Dialog` (`ui/src/components/dialog.tsx`) for anything that needs the
// user to confirm before continuing. Catches both the bare global form
// (`alert(...)`) and the explicit `window.alert(...)` form — same
// blocking-native-dialog anti-pattern either way.
const BANNED_NAMES = new Set(['alert', 'confirm', 'prompt']);

// A local binding (a param, a variable, a function) named `alert`/`window`/
// etc. shadows the browser global — `context.sourceCode.getScope(node)`
// plus a walk up the scope chain finds whether `name` resolves to such a
// binding. A resolved `Variable` with no `defs` is an implicit/env global
// (i.e. the real browser API, never user-declared), so only a variable
// with at least one `def` counts as shadowing.
function isShadowed(context, node, name) {
  let scope = context.sourceCode.getScope(node);
  while (scope) {
    const variable = scope.variables.find((candidate) => candidate.name === name);
    if (variable) return variable.defs.length > 0;
    scope = scope.upper;
  }
  return false;
}

// Dot access (`window.alert`) and static computed access (`window['alert']`)
// both resolve to a fixed property name; a dynamic computed key
// (`window[name]`) can't be resolved statically and is intentionally left
// unflagged rather than risk a false positive.
function getStaticPropertyName(memberExpression) {
  const { property, computed } = memberExpression;
  if (!computed) {
    return property.type === 'Identifier' ? property.name : null;
  }
  return property.type === 'Literal' && typeof property.value === 'string' ? property.value : null;
}

const noWindowAlert = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow window.alert()/alert()/confirm()/prompt() — use toast() for feedback or Dialog for a blocking confirmation instead.',
    },
    schema: [],
    messages: {
      noWindowAlert:
        '{{callee}}() is not allowed — use toast() (ui/src/components/toast.tsx) for feedback, or Dialog (ui/src/components/dialog.tsx) for a blocking confirmation.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node;

        // Bare `alert(...)`/`confirm(...)`/`prompt(...)` — but not a
        // locally shadowed same-named function/variable/param.
        if (
          callee.type === 'Identifier' &&
          BANNED_NAMES.has(callee.name) &&
          !isShadowed(context, callee, callee.name)
        ) {
          context.report({ node, messageId: 'noWindowAlert', data: { callee: callee.name } });
          return;
        }

        // `window.alert(...)`/`window['alert'](...)` etc. — but not a
        // locally shadowed `window` (e.g. a same-named param).
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'window' &&
          !isShadowed(context, callee.object, 'window')
        ) {
          const propertyName = getStaticPropertyName(callee);
          if (propertyName && BANNED_NAMES.has(propertyName)) {
            context.report({
              node,
              messageId: 'noWindowAlert',
              data: { callee: `window.${propertyName}` },
            });
          }
        }
      },
    };
  },
};

export default {
  rules: {
    'no-window-alert': noWindowAlert,
  },
};
