import { Body, Controller, Get, HttpCode, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtPayload, Permission } from '@biddaloy/shared';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../../common/request-context.util';
import { SETTINGS_RATE_LIMIT } from '../../../rate-limit';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { DenyWhenImpersonating } from '../../auth/decorators/deny-when-impersonating.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import {
  ChangeSupportAccessModeDto,
  ConfirmSupportAccessDto,
  SupportAccessSettingsResponseDto,
} from './dto/support-access-settings.dto';
import { SupportAccessSettingsService } from './support-access-settings.service';

type Tenant = { id: string };

@ApiTags('support-access')
@ApiTenantAuth()
@Controller('support-access')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
// SETTINGS_MANAGE is held by ADMIN only
@RequirePermissions(Permission.SETTINGS_MANAGE)
export class SupportAccessSettingsController {
  constructor(private readonly settings: SupportAccessSettingsService) {}

  @Get('settings')
  @ApiOperation({ summary: "This school's support access mode and confirmation state." })
  @ApiOkResponse({ type: SupportAccessSettingsResponseDto })
  get(@CurrentTenant() tenant: Tenant) {
    return this.settings.get(tenant.id);
  }

  @Post('confirm')
  @HttpCode(200)
  @DenyWhenImpersonating()
  @Throttle({ default: SETTINGS_RATE_LIMIT })
  @ApiOperation({ summary: 'First-login box: ticked is allowed, unticked is blocked.' })
  @ApiOkResponse({ type: SupportAccessSettingsResponseDto })
  confirm(
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConfirmSupportAccessDto,
    @Req() req: Request,
  ) {
    return this.settings.confirm(tenant.id, user.sub, dto, requestContext(req));
  }

  @Put('settings')
  @DenyWhenImpersonating()
  @Throttle({ default: SETTINGS_RATE_LIMIT })
  @ApiOperation({ summary: 'Change the mode. blocked ends every live Login as session.' })
  @ApiOkResponse({ type: SupportAccessSettingsResponseDto })
  change(
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangeSupportAccessModeDto,
    @Req() req: Request,
  ) {
    return this.settings.changeMode(tenant.id, user.sub, dto.mode, requestContext(req));
  }
}
