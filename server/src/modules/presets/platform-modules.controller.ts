import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ApprovalScope } from '@biddaloy/shared';
import { RequireApproval } from '../auth/decorators/require-approval.decorator';
import { ApprovalGuard } from '../auth/guards/approval.guard';
import type { CockpitPrincipal } from '../platform-identity/cockpit-principal';
import { PlatformAdminGuard } from '../platform-identity/platform-admin.guard';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import { requestContext } from '../../common/request-context.util';
import {
  ModuleLockDto,
  ModuleLockResponseDto,
  PlatformModulesDto,
  PlatformModulesResponseDto,
} from './dto/platform-modules.dto';
import { PlatformModulesService } from './platform-modules.service';

type CockpitReq = Request & { user: CockpitPrincipal };

/**
 * [77.6.01] Platform owners switch a module off for every school, or lock it on/off for one
 * school. Cockpit token only; both writes need a step-up token. Setting the same value twice is
 * a no-op, so no Idempotency-Key (same as the school rename route).
 */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class PlatformModulesController {
  constructor(private readonly modules: PlatformModulesService) {}

  @Get('modules')
  @ApiOperation({ summary: 'The platform module map (absent key = on).' })
  @ApiOkResponse({ type: PlatformModulesResponseDto })
  get(): Promise<PlatformModulesResponseDto> {
    return this.modules.get();
  }

  @Put('modules')
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_SCHOOL_CONTROL)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({ summary: 'Replace the platform module map. Needs a step-up token.' })
  @ApiOkResponse({ type: PlatformModulesResponseDto })
  replace(
    @Body() dto: PlatformModulesDto,
    @Req() req: CockpitReq,
  ): Promise<PlatformModulesResponseDto> {
    return this.modules.replace(dto.modules, req.user.sub, requestContext(req));
  }

  @Put('schools/:id/modules/:key/lock')
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_SCHOOL_CONTROL)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary:
      'Lock a module on or off for one school, or give control back with null. Needs a step-up token.',
  })
  @ApiOkResponse({ type: ModuleLockResponseDto })
  setLock(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @Body() dto: ModuleLockDto,
    @Req() req: CockpitReq,
  ): Promise<ModuleLockResponseDto> {
    return this.modules.setLock(id, key, dto.lock, req.user.sub, requestContext(req));
  }
}
