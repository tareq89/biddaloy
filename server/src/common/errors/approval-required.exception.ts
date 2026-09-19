import { HttpException, HttpStatus } from '@nestjs/common';
import { ApprovalScope } from '@biddaloy/shared';

/**
 * Thrown by ApprovalGuard/ApprovalService.consume whenever a route
 * decorated with @RequireApproval (or a service calling `consume`
 * imperatively) doesn't have a fresh, matching, single-use approval token
 * on the request. Every rejection reason — missing header, expired token,
 * wrong scope/actor/tenant, already-consumed jti — collapses to this same
 * 403 body so the client always has one error shape to react to (re-run
 * the step-up flow for `scope`), never a signal about *why* it failed that
 * could help an attacker narrow down which check tripped.
 */
export class ApprovalRequiredException extends HttpException {
  constructor(scope: ApprovalScope) {
    // [16.2.5] Nested under `details`, not top-level `{code, scope}`: the
    // global `AllExceptionsFilter`/`buildErrorResponseBody` only surfaces a
    // `details` key onto the wire response (`error-response.ts`'s
    // `resolveDetails`), and every consumer — `ui/src/api/errors.ts`'s
    // `ApiError.details`, `ui/src/hooks/approval.tsx`'s
    // `isApprovalRequiredError`, every component test's own
    // `approvalRequiredBody()` mock — reads `error.details.code`. The
    // previous top-level shape meant `details` was always `undefined` on
    // the real wire response, so no step-up retry flow ever actually
    // triggered outside of mocked component tests. Caught by
    // `e2e/journeys/step-up.spec.ts` hitting the real guard.
    super({ details: { code: 'APPROVAL_REQUIRED', scope } }, HttpStatus.FORBIDDEN);
  }
}
