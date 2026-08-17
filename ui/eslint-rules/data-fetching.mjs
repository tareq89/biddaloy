// [8.9.2]'s "no fetching from useEffect" guard: fetch through useQuery
// instead, so caching, retry, and error handling stay in one place. Best
// effort by design — a request made through a local helper function isn't
// caught, same tradeoff `financial-mutation.mjs`'s endpoint matching makes.
const EFFECT_HOOK_NAMES = new Set(['useEffect', 'useLayoutEffect']);

/** Generic AST descendant walker — see `financial-mutation.mjs`'s identical
 * helper for the full rationale (ESLint's visitor API only calls back on
 * node *types* it's told to listen for, not "every node under this one"). */
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

/** True for a callee that reaches the network directly: `apiClient.get(...)`,
 * `axios(...)`/`axios.post(...)`, `fetch(...)`/`window.fetch(...)`. */
function isNetworkCallCallee(callee) {
  if (callee.type === 'Identifier') {
    return callee.name === 'fetch' || callee.name === 'axios';
  }
  if (callee.type === 'MemberExpression' && !callee.computed) {
    const { object, property } = callee;
    if (object.type !== 'Identifier' || property.type !== 'Identifier') return false;
    if (object.name === 'apiClient') return true;
    if (object.name === 'axios') return true;
    if (object.name === 'window' && property.name === 'fetch') return true;
  }
  return false;
}

/** True for a callee that invokes `useEffect`/`useLayoutEffect`, either
 * directly (`useEffect(...)`) or via the `React` namespace
 * (`React.useEffect(...)`) — this codebase uses both call styles. Returns
 * the bare hook name for the report message, or `undefined` if it doesn't
 * match either form. */
function getEffectHookName(callee) {
  if (callee.type === 'Identifier' && EFFECT_HOOK_NAMES.has(callee.name)) {
    return callee.name;
  }
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'React' &&
    callee.property.type === 'Identifier' &&
    EFFECT_HOOK_NAMES.has(callee.property.name)
  ) {
    return callee.property.name;
  }
  return undefined;
}

/** Finds the first network-call `CallExpression` anywhere inside an effect
 * callback's body, including inside nested function expressions (e.g. an
 * async IIFE) — not just at the top level. Returns `null` if there isn't
 * one. */
function findNetworkCall(effectCallback) {
  let found = null;
  walk(effectCallback.body, (node) => {
    if (found) return;
    if (node.type === 'CallExpression' && isNetworkCallCallee(node.callee)) {
      found = node;
    }
  });
  return found;
}

const noFetchInEffect = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Disallow fetching data (apiClient/axios/fetch) directly inside useEffect or useLayoutEffect — use useQuery/useMutation instead, so the app QueryClient's caching, retry, and error handling apply.",
    },
    schema: [],
    messages: {
      noFetchInEffect:
        'This {{hookName}} fetches data directly — that bypasses the app QueryClient\'s cache-first rendering, retry policy, and global 403 handling. Use useQuery (or useMutation for writes) instead; see ui/README.md\'s "No fetching from useEffect" section.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const hookName = getEffectHookName(node.callee);
        if (!hookName) return;

        const [effectCallback] = node.arguments;
        if (
          !effectCallback ||
          (effectCallback.type !== 'ArrowFunctionExpression' &&
            effectCallback.type !== 'FunctionExpression')
        ) {
          return;
        }

        const networkCall = findNetworkCall(effectCallback);
        if (!networkCall) return;

        context.report({
          node: networkCall,
          messageId: 'noFetchInEffect',
          data: { hookName },
        });
      },
    };
  },
};

export default {
  rules: {
    'no-fetch-in-effect': noFetchInEffect,
  },
};
