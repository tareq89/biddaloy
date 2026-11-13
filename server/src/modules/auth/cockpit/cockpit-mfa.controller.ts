import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ApprovalScope, AuditAction, CockpitMfaStatusDto } from '@biddaloy/shared';
import { STRICT_RATE_LIMIT } from '../../../rate-limit';
import { FailClosedWithoutRedis } from '../../../common/rate-limit/app-throttler.guard';
import { requestContext } from '../../../common/request-context.util';
import { AuditService } from '../../audit/audit.service';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import type { CockpitPrincipal } from '../../platform-identity/cockpit-principal';
import { RequireApproval } from '../decorators/require-approval.decorator';
import { ApprovalGuard } from '../guards/approval.guard';
import { SameOriginGuard } from '../guards/same-origin.guard';
import { MfaService } from '../mfa/mfa.service';

/** [Epic 98 #4062] The owner's own authenticator status and recovery codes. Caller only, no id. */
@ApiTags('cockpit-auth')
@ApiBearerAuth('bearer')
@Controller('auth/cockpit')
export class CockpitMfaController {
  private readonly logger = new Logger(CockpitMfaController.name);

  constructor(
    private readonly mfa: MfaService,
    private readonly audit: AuditService,
  ) {}

  @Get('mfa-status')
  @FailClosedWithoutRedis()
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
  @ApiOperation({ summary: "Is the caller's authenticator set up, and how many codes are left." })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['enrolled', 'recoveryRemaining'],
      properties: { enrolled: { type: 'boolean' }, recoveryRemaining: { type: 'integer' } },
    },
  })
  async status(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CockpitMfaStatusDto> {
    response.setHeader('Cache-Control', 'no-store');
    return this.mfa.status((request.user as CockpitPrincipal).sub);
  }

  @Post('recovery-codes')
  @FailClosedWithoutRedis()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard, SameOriginGuard, ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_RECOVERY_CODES)
  @ApiOperation({ summary: 'New recovery codes, shown once; the old ones stop working. Step-up.' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['recoveryCodes'],
      properties: { recoveryCodes: { type: 'array', items: { type: 'string' } } },
    },
  })
  async regenerate(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ recoveryCodes: string[] }> {
    const me = request.user as CockpitPrincipal;
    const recoveryCodes = await this.mfa.regenerateRecoveryCodes(me.sub);
    const ctx = requestContext(request);
    // The codes are already committed: an audit failure must not hide them from the owner.
    // The row and the log line never carry the codes (Rule 13).
    try {
      await this.audit.record({
        action: AuditAction.PLATFORM_RECOVERY_REGENERATED,
        entity_type: 'PlatformAdmin',
        entity_id: me.sub,
        tenant_id: null,
        performed_by_user_id: me.sub,
        ip_address: ctx.ip,
        user_agent: ctx.userAgent,
        new_values: { event: 'recovery_codes_regenerated' },
      });
    } catch {
      this.logger.warn('Audit row for recovery-code regenerate was not written');
    }
    response.setHeader('Cache-Control', 'no-store');
    return { recoveryCodes };
  }
}
