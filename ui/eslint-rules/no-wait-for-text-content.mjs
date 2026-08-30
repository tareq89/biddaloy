// [#437] `.textContent` read *inside* a `waitFor(...)` callback quietly
// bakes RTL's default async-poll semantics — the callback re-runs until it
// stops throwing, so a `.textContent` read that returns `undefined`/`''`
// on an element that hasn't rendered yet keeps polling instead of failing
// fast with a useful error. `findByText`/`toHaveTextContent` give the same
// eventual-consistency wait with a real matcher and a real failure
// message. Scoped narrowly to `.textContent` inside `waitFor` — a
// measured 13-site shape (#437's plan), not the much larger
// `getBy`-inside-`waitFor` migration (#438).
//
// Dot access (`el.textContent`) and static computed access
// (`el['textContent']`) both resolve to a fixed property name; a dynamic
// computed key (`el[name]`) can't be resolved statically and is left
// unflagged rather than risk a false positive — same convention as
// `no-window-alert.mjs`'s `getStaticPropertyName`.
//
// Unlike `no-window-alert.mjs`, this rule does not check for a locally
// shadowed `waitFor` — every real call site imports it from
// `@testing-library/react`, and a rule that also tracked shadowing would
// not narrow the ticket's actual scope (13 measured sites), just its own
// code.
function getStaticPropertyName(memberExpression) {
  const { property, computed } = memberExpression;
  if (!computed) {
    return property.type === 'Identifier' ? property.name : null;
  }
  return property.type === 'Literal' && typeof property.value === 'string' ? property.value : null;
}

// Matches both the bare `waitFor(...)` import and the `vi.waitFor(...)` /
// `someAlias.waitFor(...)` member form — the bare-identifier-only version
// let `vi.waitFor` slip straight through the rule.
function isWaitForCall(node) {
  if (node.type !== 'CallExpression') return false;
  const { callee } = node;
  if (callee.type === 'Identifier') return callee.name === 'waitFor';
  if (callee.type === 'MemberExpression') return getStaticPropertyName(callee) === 'waitFor';
  return false;
}

// True only for the poll *callback* — `waitFor`'s first argument — not its
// second `options` argument. `waitFor(cb, { onTimeout })` runs `onTimeout`
// exactly once, after polling has already given up; a `.textContent` read
// there isn't the eventual-consistency footgun this rule exists for, so
// tracking depth off the whole CallExpression (which covers every
// argument equally) over-reports on it.
function isWaitForFirstCallback(node) {
  const { parent } = node;
  return Boolean(
    parent && parent.type === 'CallExpression' && isWaitForCall(parent) && parent.arguments[0] === node,
  );
}

const noWaitForTextContent = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow reading .textContent inside a waitFor(...) callback — use await screen.findByText(...) or expect(el).toHaveTextContent(...) instead.',
    },
    schema: [],
    messages: {
      noWaitForTextContent:
        'Prefer await screen.findByText(...) or expect(el).toHaveTextContent(...) over reading .textContent inside waitFor.',
    },
  },
  create(context) {
    // A counter, not a boolean, so a `waitFor` nested inside another
    // `waitFor`'s callback (unusual, but not invalid syntax) still reads
    // as "inside" until every enclosing `waitFor` call has been exited.
    let waitForDepth = 0;
    return {
      ':function'(node) {
        if (isWaitForFirstCallback(node)) waitForDepth += 1;
      },
      ':function:exit'(node) {
        if (isWaitForFirstCallback(node)) waitForDepth -= 1;
      },
      MemberExpression(node) {
        if (waitForDepth === 0) return;
        if (getStaticPropertyName(node) === 'textContent') {
          context.report({ node, messageId: 'noWaitForTextContent' });
        }
      },
    };
  },
};

export default {
  rules: {
    'no-wait-for-text-content': noWaitForTextContent,
  },
};
