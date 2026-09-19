import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiForbiddenResponse, ApiHeader } from '@nestjs/swagger';
import { ApprovalScope } from '@biddaloy/shared';

export const REQUIRE_APPROVAL_KEY = 'requireApproval';

/**
 * Declares that a route needs a fresh, single-use admin approval for
 * `scope` before it runs — enforced by ApprovalGuard, which reads the
 * `X-Approval-Token` header, verifies it, and atomically consumes it.
 * Also documents that header and the 403 shape in Swagger (matching
 * ApiTenantAuth's pattern of folding metadata + docs into one decorator).
 *
 * There is no `when?` callback here: a route that only sometimes needs
 * approval (e.g. deleting an unpaid fee is free, deleting a paid one
 * isn't) doesn't use this decorator at all — its service calls
 * `ApprovalService.consume(req, scope)` imperatively instead, from
 * whichever branch actually needs it.
 *
 * Runs alongside `@RequirePermissions(...)`: put `PermissionsGuard`
 * before `ApprovalGuard` in `@UseGuards(...)` so a caller who doesn't even
 * have the permission gets a permissions 403, not an approval one.
 *
 * @example
 * @UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard, ApprovalGuard)
 * @RequirePermissions(Permission.PAYMENTS_REVERSE)
 * @RequireApproval(ApprovalScope.PAYMENTS_REVERSE)
 */
export const RequireApproval = (scope: ApprovalScope) =>
  applyDecorators(
    SetMetadata(REQUIRE_APPROVAL_KEY, scope),
    ApiHeader({
      name: 'X-Approval-Token',
      required: true,
      description: `Single-use JWT proving a fresh admin approval for scope "${scope}" (D9). Obtained via the step-up flow, verified and consumed atomically by ApprovalGuard.`,
    }),
    ApiForbiddenResponse({
      description:
        'Missing, expired, wrong-scope, wrong-actor, wrong-tenant, or already-used approval token.',
      schema: {
        // [16.2.5] Nested under `details` — see
        // `ApprovalRequiredException`'s own comment for why the wire body
        // is `{ details: { code, scope } }` and not a top-level
        // `{ code, scope }`. Documenting the old shape here advertised a
        // contract no consumer could actually read.
        example: { details: { code: 'APPROVAL_REQUIRED', scope } },
      },
    }),
  );
