import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import type { OpsQueuesResponseDto, OpsRetryResponseDto } from './dto/ops-queues.dto';
import { OpsQueuesService } from './ops-queues.service';

/** [Epic 99 D8] Queue state and retry-failed. Drain and manual triggers stay out. */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/ops/queues')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class PlatformOpsQueuesController {
  constructor(private readonly queues: OpsQueuesService) {}

  @Get()
  @ApiOperation({ summary: 'Waiting, active, failed and delayed counts per queue.' })
  async list(@Res({ passthrough: true }) res: Response): Promise<OpsQueuesResponseDto> {
    res.setHeader('Cache-Control', 'no-store');
    return { queues: await this.queues.list() };
  }

  /**
   * No IdempotencyInterceptor (Rule 25): the one-time approval token already stops a replay, and
   * a second press retries only what failed since. The name is unvalidated here on purpose: the
   * service checks it against OPS_QUEUES and answers 404 without echoing it.
   */
  @Post(':name/retry-failed')
  @HttpCode(HttpStatus.OK)
  @FailClosedWithoutRedis()
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_OPS_ACTION)
  @ApiOperation({ summary: 'Retry up to 1000 failed jobs of one queue. Needs a step-up token.' })
  async retryFailed(
    @Param('name') name: string,
    @Req() req: { user: CockpitPrincipal },
    @Res({ passthrough: true }) res: Response,
  ): Promise<OpsRetryResponseDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.queues.retryFailed(name, req.user.sub);
  }
}
