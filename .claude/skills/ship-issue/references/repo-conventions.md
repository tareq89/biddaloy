# biddaloy repo conventions

Read this before writing code. Following the existing grain matters more than
any preference you bring — a reviewer's first question is "why does this module
look different from the other eight?"

## Layout

Yarn workspaces monorepo: `server` (NestJS API), `client-student` (Vite/React),
`shared` (`@beton-boi/shared` — enums and types used by both).

Server modules live in `server/src/modules/<name>/`:

```
<name>.module.ts      <name>.controller.ts    <name>.service.ts
dto/<name>.dto.ts     entities/*.entity.ts    *.spec.ts (co-located)
```

Shared enums go in `shared/src/enums/index.ts` — anything used as a TypeORM
`enum` column or validated by a DTO on both sides. DTO *classes* never go there;
they stay local to the module. After touching `shared/`, run `yarn build:shared`
— the server imports the compiled `dist/`, so edits are invisible until you do.

## Commands

Run from `server/`:

| Task | Command |
|---|---|
| Build | `yarn build` |
| Typecheck (this is "lint") | `yarn lint` — `tsc --noEmit` |
| Unit tests (mocked, no DB) | `yarn test:unit` |
| Coverage | `yarn test:cov` |
| Integration (needs Postgres) | `yarn test:integration` |
| Migrations | `yarn migration:run` / `:revert` / `:generate` |

The test runner is **vitest, not jest** (`vi.fn()`, not `jest.fn()`). Unit specs
are `*.spec.ts` and use mocked repositories; `*.integration.spec.ts` hits a real
database; `*.e2e-spec.ts` drives HTTP.

## Auth, tenancy, RBAC

Every tenant-scoped controller uses the same three-guard stack:

```ts
@Controller('things')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
export class ThingsController {
  @Post()
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  create(@Body() dto: CreateThingDto,
         @CurrentTenant() tenant: { id: string; role: string },
         @CurrentUser() user: JwtPayload) {
    return this.service.create(dto, tenant.id, user.sub);
  }
}
```

`ContextGuard` reads `X-Tenant-ID`, validates it against the JWT's memberships,
and attaches `request.currentTenant`. `RolesGuard` checks `@Roles` metadata;
`SUPER_ADMIN` bypasses everything.

**Role resolution** (`context.guard.ts`'s `resolveRole`): a JWT's `memberships`
array can hold more than one role for the same tenant — the unique index is
`(user_id, tenant_id, role)`, not `(user_id, tenant_id)`, so a user can
genuinely hold, say, both ADMIN and TEACHER in one tenant. With no `X-Role`
header, the highest-priority held role wins (`ROLE_PRIORITY`: SUPER_ADMIN 100,
ADMIN 90, ACCOUNTANT 80, EXECUTIVE 75, TEACHER 70, PARENT 60, STUDENT 50). An
explicit `X-Role` overrides that, but only to a role the caller actually holds
in that tenant — naming one they don't hold is a hard rejection with the exact
same message as an unknown tenant (`User is not a member of tenant ...`), never
a silent fallback to a role they do hold.

**Both guards reject with 401 (`UnauthorizedException`), never 403** — this
includes a role mismatch in `RolesGuard`, which reads like a 403 case but
isn't one here. Don't assume 403 when writing a new test or reading an old
one; a stray `// should return 403` comment next to an `.expect(401)` call
in `students.e2e-spec.ts` is a known, harmless leftover from before this was
nailed down, not a discrepancy to "fix" by changing the assertion.

**Adding a new controller:** it must carry the full
`AuthGuard('jwt'), ContextGuard, RolesGuard` stack, full stop. If it
genuinely doesn't need it (a public route, or something intentionally
bearer-only/tenant-agnostic like `POST /auth/logout-all`), it needs a
**deliberate, commented entry** in the allowlist inside
`route-guard-coverage.e2e-spec.ts` — that test enumerates every registered
route via Nest's `DiscoveryService`/`MetadataScanner` and fails the build if
a route has neither the full stack nor an allowlist entry. `AuthController`'s
own four routes are the reference example of the legitimate exceptions:
`login` (no guards — issuing credentials in the first place), `refresh`/
`logout` (`SameOriginGuard` only — cookie-authenticated, pre-tenant-selection,
see the README's CSRF posture section), `logout-all` (`AuthGuard('jwt')` only
— bearer-authenticated but tenant-agnostic, operates on the caller's own
`user.sub`/`jti`). One route type this test structurally cannot see: the
Swagger docs mount (`/api/docs`, `/api/docs-json`) is raw Express middleware
registered in `main.ts`, not a Nest controller route, so it's invisible to
`DiscoveryService` — its access control is covered separately by
`swagger-gating.e2e-spec.ts`.

**Services take `tenantId` as an explicit argument and filter on it.** Never
trust an ID from the request body without a tenant-scoped lookup first. Two
shapes exist, and picking wrong is a real vulnerability:

- Entity has its own `tenant_id` (Student, Guardian, Payment): filter directly,
  `where: { id, tenant_id: tenantId }`.
- Entity derives tenancy through a relation (Invoice → Student): load the
  relation and compare, `if (invoice.student.tenant_id !== tenantId) throw`.

Derived scoping only works when the relation is **non-optional**. If the
relation can be null, rows with a null relation end up readable by every tenant.
That exact bug shipped in PR #55 and needed a migration to fix — when in doubt,
give the entity its own `tenant_id`.

## Cross-module access

Import another module and call its **exported service**; don't register another
module's repository in your own `TypeOrmModule.forFeature`. Reaching into a
sibling's tables couples you to schema you don't own.

```ts
@Module({
  imports: [TypeOrmModule.forFeature([MyEntity]), StudentModule],
  ...
})
```

## Entities

- `@PrimaryGeneratedColumn('uuid')`, `timestamptz` timestamps, snake_case columns.
- Both the relation and its raw FK column are declared (`student` and `student_id`).
- Tenant FK: `@ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })`
  plus `@Index(['tenant_id'])`.
- Soft delete via `@DeleteDateColumn` where the domain wants it; those queries
  need `deleted_at: IsNull()`.
- New entities must be added to the `entities: [...]` array in
  `server/src/app.module.ts` — it is explicit, not glob-loaded.

## Migrations

Hand-written in `server/src/migrations/<epoch-ms>-<PascalName>.ts`. Generate the
timestamp with `node -e "console.log(Date.now())"`.

Adding a NOT NULL column to a populated table takes three steps, in order:
add nullable → backfill **every** row → `SET NOT NULL`. The established backfill
for tenant columns is the oldest school, from migration `1784175065080`:

```sql
UPDATE "table" SET "tenant_id" =
  (SELECT "id" FROM "schools" ORDER BY "created_at" ASC LIMIT 1)
WHERE "tenant_id" IS NULL
```

**Test migrations against realistic data, not an empty table.** An empty table
makes every backfill look correct because `SET NOT NULL` has nothing to reject.
Seed the awkward row first — the one with the null relation, the orphan, the
legacy shape — then run it. This is how the PR #55 migration bug was caught, and
running on an empty database is precisely how it was missed the first time.

Always verify `down()` too; a migration you can't reverse is a migration you
can't deploy confidently.

## Git and PR format

- Branch off fresh `origin/main` (local `main` is often stale):
  `git checkout -b feature-<N.M> origin/main`, then `git branch --unset-upstream`.
- Branch name mirrors the issue's bracket prefix — issue `[4.1] Communication
  Service` → `feature-4.1`. Not the issue number.
- `AGENTS.md` asks for `graphify . --update` before each commit. It needs an LLM
  API key when doc files changed; if none is set, say so rather than silently
  running `--code-only`, which reindexes docs without semantic extraction.
- Commits are conventional (`feat:`, `fix:`) with a body explaining *why*, and
  end with the `Co-Authored-By:` trailer.
- PRs merge with a merge commit (`gh pr merge <n> --merge`).

PR body shape, matching #54/#55:

```markdown
## Summary
- Bullets covering what changed and the reasoning behind non-obvious calls.
Closes #<issue>.

## Test plan
- [x] `yarn build`
- [x] `yarn lint`
- [x] `yarn test:unit` — N passing, including M new
- [x] Manual verification against real Postgres/Redis

## Notes
- Deviations from the issue text, accepted tradeoffs, follow-ups.
```

Deviating from the issue's literal wording is fine when there's a better
answer — PR #55 swapped Twilio for local BD gateways. Say so explicitly under
Notes with the reasoning, rather than quietly shipping something different.

## Testing patterns

Controller specs instantiate the controller directly with a mocked service and
assert delegation plus error propagation. They deliberately do **not** assert
role behavior: `@Roles`/`ContextGuard` don't execute on a directly constructed
controller, so such assertions would pass without testing anything. Guard
behavior is covered centrally in `auth/guards/context.guard.spec.ts` and
`auth/decorators/decorators.spec.ts`. If a reviewer asks for per-role controller
tests, explain this rather than adding assertions that can't fail.

Three root-level e2e specs are dedicated, cross-cutting access-control
regression coverage rather than belonging to any one module —
`route-guard-coverage.e2e-spec.ts` (every route carries the guard stack or is
on the reviewed allowlist), `cross-tenant-access.e2e-spec.ts` (a genuine
member of tenant B, not just an unrelated caller, is rejected by the service
layer reading tenant A's students/fees/invoices/communications), and
`role-resolution.e2e-spec.ts` (priority fallback and explicit `X-Role`,
end-to-end). A new module's own e2e spec doesn't need to repeat this
coverage — add a case to these three instead if it's genuinely testing the
guard/tenancy contract rather than that module's own business logic.

Service specs mock repositories as plain objects of `vi.fn()`. Where logic is a
pure function, extract and test it directly — `fee-dues.service.spec.ts` does
this and is the cleanest example in the repo.
