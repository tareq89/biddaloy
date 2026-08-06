// [8.4.4]'s executable guard: financial mutations (and enrolment changes —
// see the issue's own Notes on why a rolled-back transfer is just as bad
// as a rolled-back payment) must never render an optimistic success state.
// Showing "৳4,500 received" and then rolling back means the UI confirmed a
// payment that didn't happen — at a cash counter, with the parent standing
// there, that's not a glitch, it's an argument. A code-review pass catches
// this sometimes; a lint rule catches it every time a `useMutation` call
// is added or edited, which is the whole reason this is a rule and not
// just a paragraph in a README.
//
// Detection is deliberately conservative: report only when BOTH are true
// for the same `useMutation({...})` call —
//   1. a string literal anywhere inside the options object matches one of
//      `GUARDED_ENDPOINT_PATTERNS` (the request URL a `mutationFn` posts
//      to), and
//   2. the options object also declares `onMutate` (TanStack Query's only
//      mechanism for showing an optimistic state before the request
//      settles — a mutation with no `onMutate` categorically cannot render
//      before the server responds, `onSuccess`/`onSettled` only ever run
//      after).
// A mutation that hits a guarded endpoint via a helper/constant rather
// than an inline string literal won't be caught — this is a best-effort
// static check, the same tradeoff `component-boundary.mjs`'s own rules
// make (see e.g. `literalSource`'s comment there). It still catches the
// pattern this rule exists to prevent: a developer writing `onMutate` on a
// payment/fee/invoice/enrollment mutation because it's the pattern they
// just used for something low-stakes elsewhere in the same file.
const GUARDED_ENDPOINT_PATTERNS = [
  /^\/payments(\/|$)/,
  /^\/fees\/generate$/,
  /^\/invoices(\/|$)/,
  /^\/enrollments(\/|$)/,
];

/** Generic AST descendant walker — ESLint's visitor API only calls back on
 * node *types* it's told to listen for, not "every node under this one";
 * this walks every own property of every node reachable from `root`,
 * skipping `parent` (which would walk back up and out of the subtree, and
 * eventually cycle). */
function walk(root, visit) {
  const seen = new Set();
  function go(node) {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    if (Array.isArray(node)) {
      for (const item of node) go(item);
      return;
    }
    seen.add(node);
    if (typeof node.type === 'string') visit(node);
    for (const key of Object.keys(node)) {
      if (key === 'parent') continue;
      const value = node[key];
      if (value && typeof value === 'object') go(value);
    }
  }
  go(root);
}

function matchesGuardedEndpoint(value) {
  return (
    typeof value === 'string' && GUARDED_ENDPOINT_PATTERNS.some((pattern) => pattern.test(value))
  );
}

/** Matches a guarded endpoint referenced as a plain string literal
 * (`apiClient.post('/payments', ...)`) or as the static portion of a
 * template literal (`apiClient.post(\`/payments/${id}\`, ...)`), which
 * template-literal-built URLs — path params interpolated into the string
 * — use routinely. Only the *static* text (each `TemplateElement`
 * quasi's cooked value) is checked; the endpoint pattern always lives in
 * a quasi, never inside an interpolated expression, since the guarded
 * prefixes (`/payments`, `/invoices`, ...) never come from a variable. */
function findGuardedEndpointLiteral(optionsNode) {
  let found = null;
  walk(optionsNode, (node) => {
    if (found) return;
    if (node.type === 'Literal' && matchesGuardedEndpoint(node.value)) {
      found = node;
      return;
    }
    if (node.type === 'TemplateElement') {
      const text = node.value.cooked ?? node.value.raw;
      if (matchesGuardedEndpoint(text)) found = node;
    }
  });
  return found;
}

/** Matches `onMutate` written as a plain identifier key (`{ onMutate:
 * ... }`), a string-literal key (`{ 'onMutate': ... }`/`{ "onMutate":
 * ... }`), or a shorthand property (`{ onMutate }`) — every non-computed
 * way to write this key. A *computed* key (`{ [name]: ... }`) is
 * excluded on purpose: its value isn't statically known, so treating it
 * as a match risks a false positive on an unrelated dynamic key that
 * merely evaluates to the string `"onMutate"` by coincidence — the same
 * "don't report what isn't provably true" stance the endpoint check
 * above takes. */
function findOnMutateProperty(optionsNode) {
  return optionsNode.properties.find((property) => {
    if (property.type !== 'Property' || property.computed) return false;
    const { key } = property;
    return (
      (key.type === 'Identifier' && key.name === 'onMutate') ||
      (key.type === 'Literal' && key.value === 'onMutate')
    );
  });
}

const noOptimisticFinancialMutation = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow onMutate (optimistic updates) on a useMutation call that posts to a payments, fee-generation, invoice, or enrollment endpoint — those must never show a success state before the server confirms.',
    },
    schema: [],
    messages: {
      noOptimisticFinancial:
        'This mutation touches a guarded endpoint ("{{endpoint}}") — payments, fee generation, invoices, and enrollment changes must never be optimistic. Remove `onMutate` and let the UI wait for the real response; see ui/README.md\'s "Optimistic updates" section.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        if (!(callee.type === 'Identifier' && callee.name === 'useMutation')) return;

        const [optionsArg] = node.arguments;
        if (!optionsArg || optionsArg.type !== 'ObjectExpression') return;

        const guardedLiteral = findGuardedEndpointLiteral(optionsArg);
        if (!guardedLiteral) return;

        const onMutateProperty = findOnMutateProperty(optionsArg);
        if (!onMutateProperty) return;

        const endpoint =
          guardedLiteral.type === 'TemplateElement'
            ? (guardedLiteral.value.cooked ?? guardedLiteral.value.raw)
            : guardedLiteral.value;

        context.report({
          node: onMutateProperty,
          messageId: 'noOptimisticFinancial',
          data: { endpoint },
        });
      },
    };
  },
};

export default {
  rules: {
    'no-optimistic-financial-mutation': noOptimisticFinancialMutation,
  },
};
