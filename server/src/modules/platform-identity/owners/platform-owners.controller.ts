import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ApprovalScope } from '@biddaloy/shared';
import { ApprovalGuard } from '../../auth/guards/approval.guard';
import { RequireApproval } from '../../auth/decorators/require-approval.decorator';
import type { CockpitPrincipal } from '../cockpit-principal';
import { PlatformAdminGuard } from '../platform-admin.guard';
import {
  PlatformHistoryPageDto,
  PlatformHistoryQueryDto,
  PlatformOwnerDto,
} from './dto/platform-owners.dto';
import { PlatformOwnersService } from './platform-owners.service';

/**
 * [Epic 98] Owner list, lock, unlock, history. No delete route, ever (D10).
 * Lock and unlock need a step-up code but NOT the other owner: a hacked account must be
 * lockable by one person alone (D8), so no `@RequireTwoPerson` here.
 */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/owners')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class PlatformOwnersController {
  constructor(private readonly owners: PlatformOwnersService) {}

  @Get()
  @ApiOperation({ summary: 'Both owners, contacts masked.' })
  async list(@Res({ passthrough: true }) res: Response): Promise<PlatformOwnerDto[]> {
    res.setHeader('Cache-Control', 'no-store');
    return this.owners.list();
  }

  @Get('history')
  @ApiOperation({ summary: 'Platform sign-in and owner history, newest first.' })
  async history(
    @Query() q: PlatformHistoryQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PlatformHistoryPageDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.owners.history(q.cursor, q.limit);
  }

  @Post(':userId/lock')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_OWNER_LOCK)
  @ApiOperation({ summary: 'Lock another owner and end their sessions. Needs a step-up token.' })
  async lock(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: { user: CockpitPrincipal },
  ): Promise<void> {
    await this.owners.lock(req.user.sub, userId);
  }

  @Post(':userId/unlock')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_OWNER_UNLOCK)
  @ApiOperation({ summary: 'Unlock another owner. Needs a step-up token.' })
  async unlock(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: { user: CockpitPrincipal },
  ): Promise<void> {
    await this.owners.unlock(req.user.sub, userId);
  }
}
