# Pass 1 — structural / engineering review

Answers: **does this implementation correctly solve the intended problem
within the architecture of this repository?**

This pass is checklist-driven. Work through every section relevant to the
files the PR touches. Do not report anything yet — collect candidate
findings and carry them into validation
([finding-standards.md](finding-standards.md)).

## 1. Understand intent first

Before anything else, pin down:

- What problem is being solved?
- What behavior is being added or changed?
- What behavior must remain unchanged?
- What assumptions does the implementation make about its inputs, callers,
  and environment?
- Which layers are affected — backend, frontend, database, shared types,
  CI/CD?

Do not report findings until this is reasonably clear. A "bug" that's
actually intended behavior wastes the author's time and your credibility.

## 2. Correctness

- incorrect business logic, incorrect conditions, missing branches, incorrect defaults
- null/undefined handling bugs
- incorrect state transitions, off-by-one errors
- incorrect serialization/deserialization
- incorrect API contracts, frontend/backend contract mismatches (check the
  DTO/response shape the backend actually returns against what
  `shared/` types and the frontend consumer expect — these drift silently
  in this workspace since `shared/` is not regenerated automatically)
- incorrect error handling, incorrect HTTP status codes
- pagination, filtering, sorting bugs
- date/time/timezone bugs
- stale state
- incorrect permission or ownership checks

## 3. NestJS / backend

Inspect controllers, services, modules, DI wiring, guards, interceptors,
pipes, DTOs, validation decorators, exception filters, transactions,
repositories/ORM usage, async control flow, background jobs, external
service calls, config, and logging.

**Authentication is not authorization.** A route can be correctly guarded
by `@UseGuards(JwtAuthGuard)` and still let an authenticated user act on
data they don't own. Explicitly check, for every changed endpoint that
reads/writes a specific record:

- IDOR — can the ID in the request be swapped for another user's/tenant's record?
- privilege escalation — can a lower-privileged role reach this?
- resource ownership — is ownership checked in the query/service, or only implied?
- tenant isolation — is the tenant scoped at the query level, or trusted from the client?
- role/permission boundaries — do guard decorators match what the handler actually does?

## 4. PostgreSQL / database

Inspect schema changes, migrations (up **and** down), foreign keys, unique
and check constraints, nullability, indexes, queries, joins, transaction
boundaries, locking, referential integrity, cascade behavior, soft-delete
handling, and one-off data migrations.

Ask explicitly:

- Does this work against existing production data, not just a fresh dev DB?
- Does it hold up against large tables (see production-scale in Pass 2)?
- Can two concurrent requests violate an invariant this PR relies on?
- Does an invariant need a DB constraint, or is it only enforced in application code (which a second code path, a script, or a future PR can bypass)?
- Can the migration take a long lock on a large/hot table (`ALTER TABLE ... NOT NULL`, adding an index without `CONCURRENTLY`, etc.)?
- Is the migration compatible with the *currently deployed* app version while it runs (see rollout ordering in Pass 2)?
- Can the migration be safely interrupted and re-run?
- Is there a rollback path, or is this a one-way door?

## 5. React / frontend

Inspect components, hooks, local vs. server state, query/cache behavior
(React Query or equivalent), mutations and cache invalidation, loading /
error / empty states, forms and validation, navigation, URL state,
back/forward behavior, focus management, accessibility, responsive
behavior, render performance, and large-list handling.

Pay particular attention to:

- stale cached data surviving a mutation that should invalidate it
- overlapping requests in flight, and a stale response overwriting a fresher one
- navigation away while a request is still pending
- incorrect state restoration on back/forward or remount
- loading/error states that silently swallow failures (spinner never resolves, error eaten by an empty catch)

## 6. TypeScript

- unsafe `any` that erases a real guarantee
- unnecessary/unsafe type assertions (`as`) papering over a real mismatch
- incorrect optionality (`?`) vs. what's actually guaranteed at runtime
- types that claim a guarantee the runtime code doesn't enforce (e.g. a DTO typed as non-null that the validator doesn't actually require)
- frontend/backend contract drift against `shared/` types

Do not request type changes for style alone — only when a type is actively
lying about what can happen at runtime.

## 7. Security

- authN/authZ bypass, IDOR, privilege escalation, tenant isolation failures
- SQL injection (raw queries, string-built `where` clauses, unsafe `QueryBuilder` interpolation)
- XSS (unescaped render of user content, `dangerouslySetInnerHTML`)
- CSRF where session-based auth is in play
- SSRF (server making requests to a URL derived from user input)
- path traversal / unsafe file handling
- secret leakage (logged tokens, secrets in error responses, committed credentials)
- trusting client-provided security-sensitive values (role, tenant ID, price, ownership) instead of deriving them server-side
- mass assignment (DTO/entity accepting fields it shouldn't)
- excessive permissions/scopes
- unsafe redirects
- missing validation on an endpoint that previously relied on validation elsewhere

For every security finding, state the realistic attack path concretely.
Do not report a vulnerability you can't describe a plausible exploit for.

## 8. Performance

- N+1 queries (a loop issuing one query per item instead of a join/batch)
- missing indexes for a new/changed query's filter or join columns
- unbounded queries (no `LIMIT`, no pagination on a collection that grows unboundedly)
- large payloads, request waterfalls, repeated redundant API calls
- unnecessary React re-renders, expensive synchronous computation in render
- memory leaks (uncancelled subscriptions/timers/listeners)
- inefficient algorithms on data that can be large in production, even if small in the PR's tests

Think in terms of production-scale data (see Pass 2's scale checks), not
just the dev fixtures the PR was written against.

## 9. Reliability

- retries, timeouts, and their absence
- partial-failure handling (what state is left if step 2 of 3 fails?)
- transaction boundaries — is the unit of atomicity actually atomic?
- idempotency — can a retried request double-apply an effect?
- external service failure handling
- queue/job failure and retry behavior
- error propagation vs. silent swallowing

## 10. Testing

Not "are there tests" — **do these tests actually protect the changed
behavior?**

- missing regression test for the specific bug/behavior this PR fixes or adds
- happy-path-only coverage with no edge cases
- missing authorization tests (wrong user/tenant/role attempting the action)
- missing validation tests (malformed/missing/boundary input)
- tests asserting implementation details that would still pass if the real bug were reintroduced
- missing integration/DB tests for a query or transaction whose correctness depends on real DB behavior
- missing frontend interaction tests for the changed flow
- missing E2E coverage for a critical user workflow this PR touches
- flaky-looking tests (timing-dependent, order-dependent, unseeded randomness)

For every important bug found in Pass 1 or Pass 2, identify the smallest
regression test that would have caught it — this becomes part of the
finding's write-up.

## 11. CI/CD

Inspect GitHub Actions workflows, build steps, Dockerfiles, deployment
scripts, env vars/secrets usage, migration execution step, Node/package
manager versions, caching, artifacts, deployment ordering, and rollback
path.

- Can CI pass while production fails (e.g. a migration that only works against a seeded test DB)?
- Do migrations run safely relative to app deployment (before/after, and what runs during the gap)?
- Are frontend and backend versions compatible during a rolling deploy?
- Can the deployment be rolled back cleanly if this PR is bad?

## Architectural review (fold into the relevant section above)

- duplicated business logic instead of reusing an existing service/util
- persistence concerns leaking into UI, or HTTP concerns leaking into domain logic
- bypassing this repo's standard authorization/validation instead of using it
- inconsistent API, error-handling, or state-management patterns vs. the rest of the codebase
- unnecessary coupling, circular dependencies, inappropriate abstraction, or complexity the PR didn't need

Only raise these when there's a concrete, demonstrable cost (bug risk,
duplicated bug surface, broken layering that will bite the next change) —
not because another design is theoretically cleaner. Don't propose a new
library or pattern when this repo already has an established one for it.
