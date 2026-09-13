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
    super({ code: 'APPROVAL_REQUIRED', scope }, HttpStatus.FORBIDDEN);
  }
}
