// [8.9.2]'s executable guard for "a hard rule against `useEffect` fetching":
// a `useEffect`/`useLayoutEffect` that fetches data itself — instead of
// reading it from a `useQuery` — bypasses everything the app's `QueryClient`
// buys (cache-first rendering, background revalidation, `shouldRetryQuery`'s
// 4xx cutoff, the global 401/403 handling in `api/query-client.ts`). It also
// tends to race: an effect that fetches on mount has no cancellation, no
// request de-duplication across components asking for the same data, and no
// loading/error state beyond whatever the author hand-rolls with
// `useState`. A code-review pass catches this sometimes; a lint rule catches
// it every time an effect is added or edited — same reasoning as
// `financial-mutation.mjs`'s guard, and modelled directly on it.
//
// Detection is deliberately conservative: report a `CallExpression` inside a
// `useEffect`/`useLayoutEffect` callback's body only when its callee looks
// like a network call —
//   - `apiClient.<method>(...)` (the shared axios client `ui/src/api/
//     client.ts` exports — any property access, since every HTTP verb goes
//     through it),
//   - `axios(...)` / `axios.<method>(...)`,
//   - `fetch(...)` / `window.fetch(...)`.
// A request made through a local helper function (`loadStudent()`, say)
// isn't caught — this is a best-effort static check, the same tradeoff
// `financial-mutation.mjs`'s endpoint matching makes. It still catches the
// pattern this rule exists to prevent: a hand-rolled
// `useEffect(() => { apiClient.get('/students').then(setStudents) }, [])`
// instead of `useQuery({ queryKey: studentKeys.list(), queryFn: ... })`.
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

/** Finds the first network-call `CallExpression` inside an effect callback's
 * body, or `null`. Walks the whole subtree (including nested function
 * expressions) — same "best-effort, not narrowly scoped" stance
 * `financial-mutation.mjs` takes, rather than trying to distinguish an
 * effect that fetches on mount from one that only fetches from inside an
 * event handler defined within it. */
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
        'This {{hookName}} fetches data directly — that bypasses the app QueryClient\'s cache-first rendering, retry policy, and global 401/403 handling. Use useQuery (or useMutation for writes) instead; see ui/README.md\'s "No fetching from useEffect" section.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        if (!(callee.type === 'Identifier' && EFFECT_HOOK_NAMES.has(callee.name))) return;

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
          data: { hookName: callee.name },
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
