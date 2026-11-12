import {
  Controller,
  Get,
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
import type { Response } from 'express';
import { ApprovalScope } from '@biddaloy/shared';
import { FailClosedWithoutRedis } from '../../../common/rate-limit/app-throttler.guard';
import { STRICT_RATE_LIMIT } from '../../../rate-limit';
import { RequireApproval } from '../../auth/decorators/require-approval.decorator';
import { ApprovalGuard } from '../../auth/guards/approval.guard';
import type { CockpitPrincipal } from '../../platform-identity/cockpit-principal';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import type { OpsReleaseLockResponseDto, OpsSystemResponseDto } from './dto/ops-system.dto';
import { OpsSystemService } from './ops-system.service';

/** [Epic 99 D8] System card and restore-lock release. */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/ops')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class PlatformOpsSystemController {
  constructor(private readonly system: OpsSystemService) {}

  @Get('system')
  @ApiOperation({
    summary: 'App version, last migration, database and Redis state, restoring schools.',
  })
  async get(@Res({ passthrough: true }) res: Response): Promise<OpsSystemResponseDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.system.getSystem();
  }

  /** No IdempotencyInterceptor (Rule 25): the one-time approval token stops a replay, and a repeat is a no-op. */
  @Post('restore-lock/:schoolId/release')
  @HttpCode(HttpStatus.OK)
  @FailClosedWithoutRedis()
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_OPS_ACTION)
  @ApiOperation({ summary: 'Release a stuck restore lock. Needs a step-up token.' })
  async releaseLock(
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Req() req: { user: CockpitPrincipal; approval?: { approverId: string } },
    @Res({ passthrough: true }) res: Response,
  ): Promise<OpsReleaseLockResponseDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.system.releaseRestoreLock(schoolId, req.approval?.approverId ?? req.user.sub);
  }
}
