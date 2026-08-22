// [8.9.8]'s "no window.alert anywhere" AC. Native alert/confirm/prompt
// can't be styled, localized, or announced consistently with the rest of
// the shell — this codebase has a dedicated replacement for each case:
// `toast()` (`ui/src/components/toast.tsx`) for fire-and-forget feedback,
// `Dialog` (`ui/src/components/dialog.tsx`) for anything that needs the
// user to confirm before continuing. Catches both the bare global form
// (`alert(...)`) and the explicit `window.alert(...)` form — same
// blocking-native-dialog anti-pattern either way.
const BANNED_NAMES = new Set(['alert', 'confirm', 'prompt']);

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

        // Bare `alert(...)`/`confirm(...)`/`prompt(...)`.
        if (callee.type === 'Identifier' && BANNED_NAMES.has(callee.name)) {
          context.report({ node, messageId: 'noWindowAlert', data: { callee: callee.name } });
          return;
        }

        // `window.alert(...)`/`window.confirm(...)`/`window.prompt(...)`.
        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'window' &&
          callee.property.type === 'Identifier' &&
          BANNED_NAMES.has(callee.property.name)
        ) {
          context.report({
            node,
            messageId: 'noWindowAlert',
            data: { callee: `window.${callee.property.name}` },
          });
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
