// [#4283] Epic 3329 guard: which UX states each client-admin route handles, by text match.
// Strict: any (route, state) gap not in EXCEPTIONS fails; an exception whose gap is gone is stale.
// Offline, slow-network and session-expired are global (3329.1.06/1.07), so not checked per route.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'client-admin/src');

const HAS_QUERY = /\buse(?:Infinite)?Query\b|\buse[A-Z]\w*Query\b/;
const HAS_MUTATION = /\buseMutation\b|\buse[A-Z]\w*Mutation\b/;
// A shell renders its own empty / no-match states (`emptyState` prop, built-in no-match action).
const SHELL = /<(?:ListShell|DataTable)\b/;
// One-purpose sign-in / token cards: no list, no permission, one link; they show a single outcome.
const GUEST_CARD = /GuestStatus|AuthLayout/;
// Hand-rolled forms show inline errors with an alert role, ErrorText or aria-invalid.
const FORM_ERRORS = /FormMessage|role=["']alert["']|ErrorText|aria-invalid|focusFirstError/;
// Real search / filter UI, not a bare `q` or `search` identifier.
const FILTER_UI = /<(?:SearchInput|FilterBar|Filter\w*|Select\w*Filter)\b|type=["']search["']|\bsearch(?:Placeholder|Label)\b|useListShellState|onSearchChange/;
const not = (re) => (t) => !re.test(t);
const and = (...fns) => (t) => fns.every((f) => f(t));
const test = (re) => (t) => re.test(t);

const STATES = {
  loading: { when: HAS_QUERY, has: /Skeleton|RoutePending|pendingComponent/ },
  error: { when: HAS_QUERY, has: /ErrorState/ },
  empty: { when: and(test(HAS_QUERY), not(SHELL), not(GUEST_CARD)), has: /EmptyState/ },
  denied: { when: and(test(HAS_QUERY), not(GUEST_CARD)), has: /AccessDeniedState/ },
  noResult: {
    when: and(test(HAS_QUERY), test(FILTER_UI), not(SHELL), not(GUEST_CARD)),
    has: /states\.noResult|EmptyState[^>]*(?:filter|query|search)/is,
  },
  validation: { when: /<form|\buseForm\b/, has: FORM_ERRORS },
  success: { when: and(test(HAS_MUTATION), not(GUEST_CARD)), has: /toast|SuccessTick/ },
};

// Justified (route|state) exceptions, each with one reason. An exception that no longer matches a gap is stale.
export const EXCEPTIONS = {
  '_staff/print/committee-report.tsx|empty': 'print summary renders zeros for a school with no data; there is no list',
  '_staff/reports/printables.tsx|denied': 'route-permission gated; the history table shows its own load error',
  '_staff/security.tsx|empty': 'the session list always holds the current session',
  '_staff/welcome.tsx|denied': 'wizard; the route is permission gated and writes fail with a toast',
  '_staff/welcome.tsx|empty': 'wizard steps, not a list',
  '_staff/welcome.tsx|error': 'onboarding status failing falls back to the guided default; saves show an inline failure',
  'activate.tsx|validation': 'the resend form has one field and the server answer is shown by GuestStatus',
  'login.tsx|error': 'the social-provider list is optional; a failure just shows no provider buttons',
  'login.tsx|loading': 'the social-provider list is optional; the card renders without it',
  'n.$token.tsx|error': 'PublicNotice shows its own pending and error card (GuestStatus)',
  'portal/account.tsx|empty': 'account cards, not a list; the session list always holds the current one',
  'portal/notices/$noticeId.tsx|empty': 'single notice detail; a missing notice is the denied/error card',
  'register.tsx|error': 'RegisterFlow shows each failed step inline on its own card',
  'register.tsx|loading': 'RegisterFlow buttons carry their own pending state',
};

const isRoute = (f) => f.endsWith('.tsx') && !/(^|\/)-/.test(f) && !/\.(test|stories)\.tsx$/.test(f);
const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

function resolveImport(from, spec) {
  const base = spec.startsWith('@/') ? join(SRC, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  return [`${base}.tsx`, join(base, 'index.tsx')].find(existsSync) ?? null;
}

// Returns [{route, state}] gaps for every route file under routesDir.
export function audit(routesDir) {
  const gaps = [];
  for (const file of walk(routesDir)) {
    const route = relative(routesDir, file);
    if (!isRoute(route)) continue;
    const own = readFileSync(file, 'utf8');
    const views = [...own.matchAll(/from\s+['"]([^'"]+)['"]/g)]
      .map((m) => resolveImport(file, m[1]))
      .filter(Boolean)
      .map((f) => readFileSync(f, 'utf8'));
    if (/<Outlet\b/.test(own)) continue; // layout-only route: its children carry the states
    const text = [own, ...views].join('\n');
    for (const [state, { when, has }] of Object.entries(STATES)) {
      const needed = typeof when === 'function' ? when(text) : when.test(text);
      if (needed && !has.test(text)) gaps.push({ route, state });
    }
  }
  return gaps;
}

export const withoutExceptions = (gaps, exceptions = EXCEPTIONS) => gaps.filter((g) => !(`${g.route}|${g.state}` in exceptions));

const key = (g) => `${g.route}|${g.state}`;

function main() {
  const all = audit(join(SRC, 'routes'));
  const gaps = withoutExceptions(all);
  const unused = Object.keys(EXCEPTIONS).filter((k) => !all.some((g) => key(g) === k));
  if (gaps.length) console.error(`New UX-state gaps (add the state, or a justified EXCEPTIONS line):\n  ${gaps.map(key).join('\n  ')}`);
  if (unused.length) console.error(`Stale exceptions (the gap is gone; remove them):\n  ${unused.join('\n  ')}`);
  process.exit(gaps.length || unused.length ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
