// [#4283] Epic 3329 guard: which UX states each client-admin route handles, by text match.
// A (route, state) gap must be in scripts/ux-states-baseline.json; a fixed baseline line is stale.
// Offline, slow-network and session-expired are global (3329.1.06/1.07), so not checked per route.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'client-admin/src');
const BASELINE = join(root, 'scripts/ux-states-baseline.json');

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

// W2 lane (3329.2.01-2.10) per route group; first match wins. ponytail: path-prefix map, edit when W2 lanes move.
const LANES = [
  ['2.04', /^_staff\/(fees|fee-structures|invoices|payments)\b/],
  ['2.01', /^_staff\/(students|guardians|admissions|applications)\b/],
  ['2.02', /^_staff\/(staff|roles|classes|academics|academic-years|curriculum|promotions)\b/],
  ['2.03', /^_staff\/(attendance|calendar|routines|my-class|my-coordination)\b/],
  ['2.05', /^_staff\/(exams|marks|results|analysis|grading-scales|programs)\b/],
  ['2.06', /^_staff\/(reports|print|print-templates|audit-logs)\b/],
  ['2.08', /^portal\b/],
  ['2.09', /^_platform\b/],
  ['2.10', /^(?!_staff)/],
  ['2.07', /^_staff\b/],
];
const laneOf = (route) => LANES.find(([, re]) => re.test(route))[0];
const groupOf = (route) => {
  const p = route.split('/');
  if (p[0] === '_staff' || p[0] === '_platform') return p.slice(0, 2).join('/').replace(/\.tsx$/, '');
  return p[0] === 'portal' ? 'portal' : 'public';
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

// Pure compare: new gaps and stale baseline lines.
export function compare(gaps, baseline) {
  const now = new Set(gaps.map(key));
  return {
    added: [...now].filter((k) => !(k in baseline)),
    stale: Object.keys(baseline).filter((k) => !now.has(k)),
  };
}

function main() {
  const all = audit(join(SRC, 'routes'));
  const gaps = withoutExceptions(all);
  const unused = Object.keys(EXCEPTIONS).filter((k) => !all.some((g) => key(g) === k));
  if (process.argv.includes('--write-baseline')) {
    const out = {};
    for (const g of gaps.sort((a, b) => key(a).localeCompare(key(b)))) out[key(g)] = laneOf(g.route);
    writeFileSync(BASELINE, `${JSON.stringify(out, null, 2)}\n`);
  }
  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
  const perGroup = {};
  for (const g of gaps) {
    const row = (perGroup[`${laneOf(g.route)}  ${groupOf(g.route)}`] ??= {});
    row[g.state] = (row[g.state] ?? 0) + 1;
  }
  console.table(
    Object.fromEntries(
      Object.entries(perGroup)
        .sort()
        .map(([k, v]) => [k, { total: Object.values(v).reduce((a, b) => a + b, 0), ...v }]),
    ),
  );
  const { added, stale } = compare(gaps, baseline);
  if (added.length) console.error(`New UX-state gaps (fix them, do not baseline):\n  ${added.join('\n  ')}`);
  if (stale.length) console.error(`Stale baseline lines (fixed; remove with --write-baseline):\n  ${stale.join('\n  ')}`);
  if (unused.length) console.error(`Stale exceptions (the gap is gone; remove them):\n  ${unused.join('\n  ')}`);
  process.exit(added.length || stale.length || unused.length ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
