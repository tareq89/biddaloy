import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ApprovalScope } from '@biddaloy/shared';
import { RequireApproval } from '../../auth/decorators/require-approval.decorator';
import { ApprovalGuard } from '../../auth/guards/approval.guard';
import type { CockpitPrincipal } from '../../platform-identity/cockpit-principal';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import { STRICT_RATE_LIMIT } from '../../../rate-limit';
import { AdminResetLinkResponseDto, LogoutAllResponseDto } from './dto/school-help.dto';
import { SchoolHelpService } from './school-help.service';

type CockpitReq = Request & { user: CockpitPrincipal };
const ctx = (req: Request) => ({ ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null });

/**
 * [Epic 99] Cockpit school help. No Idempotency-Key: both actions are safe to repeat (a second
 * reset voids the first link; a second logout-all signs out the same people again).
 */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/schools/:id')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard, ApprovalGuard)
@RequireApproval(ApprovalScope.PLATFORM_SCHOOL_CONTROL)
@Throttle({ default: STRICT_RATE_LIMIT })
export class SchoolHelpController {
  constructor(private readonly help: SchoolHelpService) {}

  @Post('admins/:userId/reset-link')
  @ApiOperation({ summary: 'Send a school admin a password reset link. Needs a step-up token.' })
  async resetLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: CockpitReq,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminResetLinkResponseDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.help.sendAdminResetLink(id, userId, req.user.sub, ctx(req));
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign every user of a school out. Needs a step-up token.' })
  async logoutAll(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: CockpitReq,
  ): Promise<LogoutAllResponseDto> {
    return this.help.logoutAll(id, req.user.sub, ctx(req));
  }
}
