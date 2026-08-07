# Pass 2 — adversarial / failure-oriented review

This pass must be **independent** of Pass 1 — don't just relabel Pass 1
notes as "adversarial." Assume Pass 1 missed a real production bug and
actively try to break the implementation as written, not the implementation
as described in the PR body.

Never skip this pass because the PR is small, test-only, frontend-only,
backend-only, or CI is green. Those are exactly the conditions where subtle
bugs survive review.

## Input failures

Try, against every changed input surface (DTO, form, query param, path
param, env var, uploaded file):

- empty input, missing fields, `null`, `undefined`
- malformed IDs (wrong type, wrong format, another entity's ID)
- invalid enum values not in the declared union
- invalid/out-of-range dates
- negative numbers, zero, extremely large numbers
- duplicate values where uniqueness is assumed
- unexpected extra fields (mass assignment)
- unexpected Unicode / control characters
- oversized payloads

**Assume frontend validation can be bypassed** — every check that exists
only in a React form or a Zod schema on the client, and not in the NestJS
DTO/pipe/service, does not exist as far as this review is concerned.

## Authorization attacks

Try, for every changed endpoint:

- another user's resource ID
- another tenant's resource ID
- a lower-privileged role's token
- a manually crafted HTTP request that skips the UI entirely
- a modified URL param, query param, or request body field
- a direct API call for an action the UI only exposes conditionally (e.g. a button that's hidden but the endpoint isn't guarded)

Ask directly: **can an authenticated but unauthorized user perform this
operation?** If the answer relies on "the UI wouldn't let them," that is
not authorization.

## Race conditions

Try (mentally trace, don't need to actually run):

- two identical requests fired simultaneously (double-click, retry-on-timeout)
- two users editing the same record concurrently
- duplicate form submissions
- a network retry after a request that actually succeeded server-side
- read-then-write races (check-then-act without a DB-level guarantee)
- concurrent actions on the same constrained resource (e.g. seat/slot allocation, balance changes)
- a response arriving after the UI state has already moved on

Ask: **can this operation happen twice when it should happen once?** and
**what database constraint or transaction actually prevents that** — not
what application-level check *intends* to prevent it, since app-level
checks alone don't survive concurrency.

## Database failures

- insert/update failure mid-operation
- constraint violation surfaced as an unhandled 500 instead of a clean error
- timeout, deadlock
- partial transaction (some statements committed, others not, if boundaries are wrong)
- the related row being concurrently modified or deleted between a read and a dependent write

Ask: **can the database end up in an inconsistent state because of this
change**, and if so, is that reachable from normal (not just adversarial)
usage?

## API failures

For every new/changed HTTP call (frontend → backend, or backend → external
service), consider 400/401/403/404/409/422/429/500, timeout, connection
failure, slow response, and duplicate/out-of-order response. Check whether
the caller (UI or service) actually recovers correctly, or silently breaks/hangs/shows stale data.

## Frontend stale-state failures

- user changes the same data in another tab
- user navigates back to a page with stale server state
- user refreshes mid-flow
- user submits a form while a previous submission is still pending
- the selected entity changes while a request for the old selection is still in flight
- a stale response arrives after a newer one and overwrites it
- a mutation succeeds but the cache is never invalidated
- an optimistic UI update isn't rolled back when the mutation actually fails

Ask: **does the UI still represent reality** after each of these?

## Production-scale failures

Reason about this at 10, 10,000, and 1,000,000+ rows, not just the PR's
test fixtures:

- Is pagination actually bounded, or can a client request everything?
- Are the query's filter/join/sort columns indexed?
- Does the query stay efficient, or does it degrade non-linearly?
- Are API payload sizes bounded?
- Is the frontend rendering an unbounded list without virtualization?
- Is there an N+1 hiding behind a small fixture that only shows up with real data volume?
- Is memory usage bounded (streaming vs. loading everything into memory)?

## Deployment failures

Simulate a rolling deploy explicitly:

1. Old app version still running against the old schema.
2. Migration runs.
3. Some instances are still on old code while others are already on new code (rolling restart, not atomic cutover).
4. Frontend and backend deploy on separate pipelines/timings in this workspace (`server`, `client-admin`, `client-student`, `ui`) — they are not guaranteed to land atomically.
5. Deployment partially fails and is rolled back.

Ask:

- Can old backend code run against the new schema?
- Can new backend code run against data written under the old schema/logic?
- Can an old frontend build work against the new backend contract?
- Can a new frontend build work against the still-old backend (if it deploys first)?
- Can the migration be safely interrupted?
- Can the whole deployment be rolled back without a manual data-fix step?

## Regression analysis

Ask: **what unrelated functionality could this PR accidentally break?**
Use repo search for other call sites of changed functions, other consumers
of changed shared types, other tests exercising the same module, and
anything importing the changed file. A change to a shared util, guard, or
`shared/` type can silently affect code far from the diff.
