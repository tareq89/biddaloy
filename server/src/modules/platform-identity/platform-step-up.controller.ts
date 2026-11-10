import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuditAction } from '@biddaloy/shared';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import { FailClosedWithoutRedis } from '../../common/rate-limit/app-throttler.guard';
import { requestContext } from '../../common/request-context.util';
import { AuditService } from '../audit/audit.service';
import { cockpitUserLockKey } from '../auth/cockpit/cockpit-auth.service';
import { LoginAttemptService } from '../auth/login-attempt.service';
import { MfaService } from '../auth/mfa/mfa.service';
import { PLATFORM_APPROVAL_SCOPES, StepUpService } from '../auth/step-up.service';
import type { CockpitPrincipal } from './cockpit-principal';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformHomeService } from './platform-home.service';
import { PlatformStepUpDto, PlatformStepUpResponse } from './dto/platform-step-up.dto';

const REFUSED = 'Code is not valid. Wait for the next code and try again.';

/**
 * [Epic 98] A cockpit owner proves a fresh authenticator code and gets the same single-use
 * approval token the school app uses. Recovery codes are not accepted. Writes its own audit row.
 */
@ApiTags('platform')
@ApiBearerAuth()
// No SameOriginGuard: the cockpit-jwt strategy reads only the Authorization bearer header, never a
// cookie, so a cross-site request cannot carry the credential.
@Controller('platform/step-up')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class PlatformStepUpController {
  constructor(
    private readonly stepUp: StepUpService,
    private readonly mfa: MfaService,
    private readonly loginAttempts: LoginAttemptService,
    private readonly home: PlatformHomeService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @FailClosedWithoutRedis()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({ summary: 'Authenticator code in, single-use approval token out.' })
  async issue(
    @Body() dto: PlatformStepUpDto,
    @Req() request: Request & { user: CockpitPrincipal },
    @Res({ passthrough: true }) response: Response,
  ): Promise<PlatformStepUpResponse> {
    // Scope first: an unknown or school scope must not burn the owner's TOTP step.
    if (!PLATFORM_APPROVAL_SCOPES.includes(dto.scope)) throw new UnauthorizedException(REFUSED);
    const actorId = request.user.sub;
    const key = cockpitUserLockKey(actorId);
    if (await this.loginAttempts.isLocked(key)) throw new UnauthorizedException(REFUSED);

    // verifyCode refuses a step already used (sign-in or an earlier step-up): the replay guard.
    const ok =
      /^\d{6}$/.test(dto.code.trim()) && (await this.mfa.verifyCode(actorId, dto.code.trim()));
    if (!ok) {
      await this.loginAttempts.recordFailure(key);
      throw new UnauthorizedException(REFUSED);
    }

    const homeId = await this.home.id();
    if (!homeId) throw new UnauthorizedException(REFUSED);
    const token = await this.stepUp.issueForPlatformAdmin(actorId, dto.scope, homeId);

    const ctx = requestContext(request);
    await this.audit.record({
      action: AuditAction.CREATE,
      entity_type: 'ApprovalToken',
      entity_id: token.jti,
      tenant_id: null,
      performed_by_user_id: actorId,
      ip_address: ctx.ip,
      user_agent: ctx.userAgent,
      new_values: { scope: dto.scope, actor_id: actorId },
    });
    response.setHeader('Cache-Control', 'no-store');
    return { approval_token: token.approval_token, expires_at: token.expires_at };
  }
}
