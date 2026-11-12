import {
  Controller,
  Get,
  HttpCode,
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
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ApprovalScope } from '@biddaloy/shared';
import { STRICT_RATE_LIMIT } from '../../../rate-limit';
import { RequireApproval } from '../../auth/decorators/require-approval.decorator';
import { ApprovalGuard } from '../../auth/guards/approval.guard';
import type { CockpitPrincipal } from '../../platform-identity/cockpit-principal';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import { SearchPlatformUsersQueryDto, type PlatformUserItem } from './dto/platform-users.dto';
import { PlatformUsersService } from './platform-users.service';

/** [Epic 99] Cockpit people search and "sign out everywhere". */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/users')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class PlatformUsersController {
  constructor(private readonly users: PlatformUsersService) {}

  @Get()
  @ApiOperation({ summary: 'Find a person by email or phone across all schools.' })
  search(
    @Query() query: SearchPlatformUsersQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PlatformUserItem[]> {
    res.setHeader('Cache-Control', 'no-store');
    return this.users.search(query.q, query.limit);
  }

  /** Repeating it is harmless (it only moves the cut-off), so no Idempotency-Key. */
  @Post(':id/logout')
  @HttpCode(204)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_SCHOOL_CONTROL)
  @ApiOperation({ summary: 'Sign a person out everywhere. Needs a step-up token.' })
  async logout(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: CockpitPrincipal },
  ): Promise<void> {
    await this.users.logout(id, req.user.sub);
  }
}
