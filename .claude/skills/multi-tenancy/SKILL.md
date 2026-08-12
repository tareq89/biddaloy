---
name: multi-tenancy
description: >
  Enforces Biddaloy's tenant-isolation rules whenever you create or touch a
  School-scoped entity, endpoint, query, background job, cache key, file, or
  export. Trigger on: adding a new entity/table, a new controller route, a
  new repository/service query, a new BullMQ job, a new cache key, a new
  file upload or export, or any code that reads/writes student, guardian,
  fee, payment, or communication data. Also trigger when asked to "add a
  feature", "add an endpoint", "add a query", or "add a table" in server/.
---

# Multi-Tenancy Rules (Biddaloy)

For the *why* (the `School`/`UserTenant` model, the JWT/header contract,
diagrams), see
[`docs/architecture/02-auth-and-multitenancy.md`](../../../docs/architecture/02-auth-and-multitenancy.md).
This skill is the *checklist* — apply it every time, don't just read it once.

## The one rule

**There is no automatic tenant filter.** No TypeORM subscriber, no global
query interceptor scopes queries to a tenant for you. Every single query
must explicitly filter by `tenant_id`, by hand, every time. Forgetting one
`where` clause is a real cross-tenant data leak, not a theoretical one —
this is the #1 thing to check in your own diff before calling a change done.

Real example, from `students.service.ts` — this is the pattern, copy it:

```typescript
async findOne(id: string, tenantId: string): Promise<Student> {
  const student = await this.repo.findOne({
    where: { id, tenant_id: tenantId, deleted_at: IsNull() },
  });
  ...
}
```

`tenantId` is threaded as an explicit parameter through every service
method — never pulled implicitly from ambient/global state.

## Checklist — new entity

- [ ] Direct `@ManyToOne(() => School)` + `tenant_id: string` column — even
      if a tenant could technically be derived through another relation.
      (`CommunicationLog` and `ReminderBatch` store `tenant_id` directly
      rather than deriving it from `student`/`initiated_by`, specifically so
      a row with an unpopulated optional relation is never accidentally
      readable cross-tenant.)
- [ ] `@DeleteDateColumn()` — soft delete, never hard-delete tenant data.
- [ ] Add a docstring above the entity listing its relations (existing
      entities all do this — match the style).

## Checklist — new endpoint / controller

- [ ] Controller has `@ApiTenantAuth()` and
      `@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)`.
- [ ] Every route has `@Roles(UserRole.X, ...)` naming the roles allowed —
      never leave a tenant-scoped route without an explicit role list.
- [ ] Route reads tenant via `@CurrentTenant() tenant: { id: string; role: string }`,
      not from a body/query param the client could spoof.
- [ ] `tenant.id` is passed into every service call that follows.

## Checklist — new query / repository method

- [ ] `where` clause includes `tenant_id: tenantId` (or the query-builder
      equivalent, `.andWhere('x.tenant_id = :tenantId', { tenantId })`).
- [ ] Any join to another tenant-scoped table also relies on that table's
      own `tenant_id` being correct — don't assume a join implies matching
      tenants unless the FK is scoped.
- [ ] Bulk update/delete (`repo.update(...)`, `repo.delete(...)`) includes
      `tenant_id` in the match criteria too — not just `id`. (See
      `students.service.ts`'s `update()`: `{ id, tenant_id: tenantId }`.)

## Checklist — background job / cache key / file / export

- [ ] BullMQ job payload carries `tenantId` explicitly; the processor
      re-derives scoping from the payload, never from whatever tenant
      happened to be active when the job was enqueued.
- [ ] Cache keys are prefixed with the tenant id (`tenant:<id>:...`) — a
      shared key across tenants is a leak even if the value looks harmless.
- [ ] Generated files (exports, invoices, reports) are scoped to one tenant
      per file — never a cross-tenant batch in one artifact.

## Frontend

The `apiClient` (`ui/src/api/client.ts`) already attaches `X-Tenant-ID`/
`X-Role` automatically from the active-tenant state — **don't** manually
add those headers in a component or hook. If you're building a UI feature,
use the shared `apiClient`/generated query hooks rather than a raw
`fetch`/`axios` call, or you'll bypass this and silently drop tenant
scoping on that request.

## Mandatory test

Every new tenant-scoped endpoint needs a cross-tenant-isolation test, not
just a happy-path test — matching `server/CLAUDE.md`'s "Tenant Isolation"
rule and the existing `cross-tenant-access.e2e-spec.ts` pattern:

```typescript
it('rejects a request scoped to a tenant the user does not belong to', async () => {
  // login as a user who belongs to Tenant A, then call this endpoint
  // with X-Tenant-ID: <Tenant B's id> — must fail, not just return empty.
});
```

## When in doubt

Prefer the narrower, project-specific rule here over generic ORM/API advice
— this model (manual per-query scoping, tenant on the JWT + header, roles
per-tenant via `UserTenant`) is a deliberate choice already made for this
codebase, not something to redesign mid-feature.
