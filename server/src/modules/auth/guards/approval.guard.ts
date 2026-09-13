import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';
import { ApprovalScope } from '@biddaloy/shared';
import { ApprovalRequiredException } from '../../../common/errors/approval-required.exception';
import { REQUIRE_APPROVAL_KEY } from '../decorators/require-approval.decorator';

export const APPROVAL_REDIS = 'APPROVAL_REDIS';

/** D9's token contract: `{sub: approver, act: actor, tid, scope, jti}`, `typ: 'approval'`. */
export interface ApprovalTokenPayload {
  typ: 'approval';
  sub: string;
  act: string;
  tid: string;
  scope: ApprovalScope;
  jti: string;
}

/** Attached to the request by a successful `consume()`, for handlers/audit calls downstream. */
export interface ApprovalContext {
  approverId: string;
  scope: ApprovalScope;
  jti: string;
}

function approvalKey(jti: string): string {
  return `approval:${jti}`;
}

/**
 * Verifies and atomically single-uses an `X-Approval-Token` for `scope`
 * against the current request's actor and tenant.
 *
 * Two entry points share this one check:
 * - `ApprovalGuard` calls it for routes carrying `@RequireApproval(scope)`.
 * - A service calls it directly for a route that only *sometimes* needs
 *   approval (e.g. deleting an unpaid fee is free, a paid one isn't) —
 *   `@RequireApproval` has no `when?` callback on purpose, per D9/#647's
 *   plan; that branch decides for itself and calls `consume`.
 *
 * Every rejection reason (missing header, bad signature, wrong `typ`,
 * expired, wrong tenant/actor/scope, already-consumed `jti`) throws the
 * same `ApprovalRequiredException` — the client's remedy is identical in
 * every case (run the step-up flow again for `scope`), and not leaking
 * *which* check failed avoids handing an attacker a token-shape oracle.
 */
@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(APPROVAL_REDIS) private readonly redis: Redis,
  ) {}

  async consume(
    req: {
      headers: Record<string, string | string[] | undefined>;
      currentTenant?: { id: string };
      user?: { sub: string };
    },
    scope: ApprovalScope,
  ): Promise<ApprovalContext> {
    const header = req.headers['x-approval-token'];
    const token = Array.isArray(header) ? header[0] : header;
    if (!token) {
      throw new ApprovalRequiredException(scope);
    }

    let payload: ApprovalTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<ApprovalTokenPayload>(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
    } catch {
      // Expired, malformed, or wrongly-signed — same 403 as "missing".
      throw new ApprovalRequiredException(scope);
    }

    if (
      payload.typ !== 'approval' ||
      !payload.sub ||
      !payload.act ||
      !payload.tid ||
      !payload.scope ||
      !payload.jti
    ) {
      throw new ApprovalRequiredException(scope);
    }

    if (!req.currentTenant || !req.user) {
      // ContextGuard/AuthGuard('jwt') didn't run before this — a
      // misconfigured @UseGuards ordering, not a client error.
      throw new UnauthorizedException('No active session context');
    }

    if (payload.tid !== req.currentTenant.id) {
      throw new ApprovalRequiredException(scope);
    }
    if (payload.act !== req.user.sub) {
      throw new ApprovalRequiredException(scope);
    }
    if (payload.scope !== scope) {
      throw new ApprovalRequiredException(scope);
    }

    // GETDEL (atomic get-then-delete, Redis >= 6.2) rather than GET+DEL —
    // atomicity is what makes it impossible for two concurrent requests
    // carrying the same token to both succeed. Only the request whose
    // GETDEL actually returns the stored '1' gets to proceed; the loser
    // sees a miss and is rejected, even though its JWT was perfectly
    // valid on its own.
    let consumed: string | null;
    try {
      consumed = await this.redis.getdel(approvalKey(payload.jti));
    } catch (error) {
      this.logger.error(
        `Failed to consume approval token ${payload.jti}: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Unlike AccessTokenDenylistService, this does NOT fail open — a
      // Redis outage here must not silently let every approval-gated
      // action through unchecked.
      throw new ApprovalRequiredException(scope);
    }
    if (consumed !== '1') {
      throw new ApprovalRequiredException(scope);
    }

    return { approverId: payload.sub, scope, jti: payload.jti };
  }
}

/**
 * Enforces `@RequireApproval(scope)` on a route by delegating to
 * `ApprovalService.consume` and stamping the result onto `req.approval`.
 *
 * No metadata on handler/class → allow, same convention as
 * RolesGuard/PermissionsGuard. Put this guard *after* PermissionsGuard in
 * `@UseGuards(...)` — a caller who lacks the base permission should see a
 * permissions 403, not an approval one; NestJS runs guards in the order
 * they're listed, left to right.
 */
@Injectable()
export class ApprovalGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    private readonly approvalService: ApprovalService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const scope = this.reflector.getAllAndOverride<ApprovalScope | undefined>(
      REQUIRE_APPROVAL_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!scope) return true;

    const request = context.switchToHttp().getRequest();
    request.approval = await this.approvalService.consume(request, scope);
    return true;
  }
}
