import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Permission } from '@biddaloy/shared';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { SETTINGS_RATE_LIMIT } from '../../../rate-limit';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import {
  EndSupportSessionResultDto,
  PlatformActionItemDto,
  SupportSessionItemDto,
  SupportViewQueryDto,
} from './dto/support-sessions.dto';
import { SupportSessionsService } from './support-sessions.service';

type Tenant = { id: string };

@ApiTags('support-access')
@ApiTenantAuth()
@Controller('support-access')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
// SETTINGS_MANAGE is held by ADMIN only
@RequirePermissions(Permission.SETTINGS_MANAGE)
export class SupportSessionsController {
  constructor(private readonly sessions: SupportSessionsService) {}

  @Get('sessions')
  @ApiOperation({ summary: 'Login as sessions of this school, last 90 days.' })
  @ApiOkResponse({ type: SupportSessionItemDto, isArray: true })
  list(@CurrentTenant() tenant: Tenant, @Query() q: SupportViewQueryDto) {
    return this.sessions.listSessions(tenant.id, q);
  }

  @Get('platform-actions')
  @ApiOperation({ summary: "Biddaloy's own actions on this school, last 90 days." })
  @ApiOkResponse({ type: PlatformActionItemDto, isArray: true })
  platformActions(@CurrentTenant() tenant: Tenant, @Query() q: SupportViewQueryDto) {
    return this.sessions.listPlatformActions(tenant.id, q);
  }

  // Not @DenyWhenImpersonating: ending access is always safe (an owner inside Login as who calls
  // this is recorded as SCHOOL_ADMIN, accepted).
  @Post('sessions/:id/end')
  @HttpCode(200)
  @Throttle({ default: SETTINGS_RATE_LIMIT })
  @ApiOperation({ summary: 'End a live session now. Already over is a 200.' })
  @ApiOkResponse({ type: EndSupportSessionResultDto })
  end(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.end(tenant.id, id);
  }
}
