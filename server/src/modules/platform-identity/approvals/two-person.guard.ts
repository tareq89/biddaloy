import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import { PlatformAdminService } from '../platform-admin.service';
import { hashPayload, PlatformApprovalsService } from './platform-approvals.service';
import { PlatformSettingsService, APPROVALS_ENABLED_KEY } from './platform-settings.service';
import { REQUIRE_TWO_PERSON_KEY, TwoPersonMetadata } from './require-two-person.decorator';

/**
 * [Epic 98] `@RequireTwoPerson(scope, summaryFn)`. Enforced only while the switch is on AND at
 * least two owners are active (D8), so a locked owner never blocks the other. Put it after
 * `PlatformAdminGuard`. With `X-Platform-Approval: <id>` it claims that grant once for this exact
 * request; without it, it files a request and answers 403 APPROVAL_REQUESTED.
 */
/** `strict` routes (a free coupon) never fall back to one owner: no second owner means no action. */
const secondOwnerRequired = () =>
  new HttpException({ details: { code: 'SECOND_OWNER_REQUIRED' } }, HttpStatus.FORBIDDEN);

@Injectable()
export class TwoPersonGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly settings: PlatformSettingsService,
    private readonly owners: PlatformAdminService,
    private readonly approvals: PlatformApprovalsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<TwoPersonMetadata | undefined>(
      REQUIRE_TWO_PERSON_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!meta) return true;

    const req = context.switchToHttp().getRequest();
    await this.enforce(req, meta.scope, meta.summaryFn(req), meta.strict);
    return true;
  }

  /**
   * The check itself. A route that only SOMETIMES needs the other owner (e.g. switching the gate
   * off, not on) calls this from its handler instead of using the decorator.
   */
  async enforce(
    req: any,
    scope: TwoPersonMetadata['scope'],
    summary: Record<string, unknown>,
    strict = false,
  ): Promise<void> {
    const actorId: string | undefined = req.user?.sub;
    if (!actorId) throw new ForbiddenException('This area is for platform owners only');

    const enabled = (await this.settings.get(APPROVALS_ENABLED_KEY)) !== false;
    if (!enabled) {
      if (strict) throw secondOwnerRequired();
      return;
    }
    // Read after any owner lock in flight: a requester locked meanwhile is refused here, instead
    // of slipping through because the active count just fell to one.
    // ponytail: the handler's own write runs after this check; a lock that lands in that gap is
    // the same window every request has between its auth check and its write.
    const active = await this.owners.activeOwnerIds();
    if (!active.includes(actorId))
      throw new ForbiddenException('This area is for platform owners only');
    if (active.length < 2) {
      if (strict) throw secondOwnerRequired();
      return;
    }

    const payload = {
      method: req.method as string,
      path: String(req.originalUrl ?? req.url).split('?')[0],
      body: req.body,
    };
    const header = req.headers?.['x-platform-approval'];
    const id = Array.isArray(header) ? header[0] : header;
    if (id) {
      const ok = isUUID(id) && (await this.approvals.consume(id, actorId, hashPayload(payload)));
      if (ok) return;
      throw new HttpException({ details: { code: 'APPROVAL_INVALID' } }, HttpStatus.FORBIDDEN);
    }
    const { id: requestId } = await this.approvals.request(actorId, scope, payload, summary);
    throw new HttpException(
      { details: { code: 'APPROVAL_REQUESTED', requestId } },
      HttpStatus.FORBIDDEN,
    );
  }
}
