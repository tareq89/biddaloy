import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PlatformSuperAdminGuard } from '../../auth/guards/platform-super-admin.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AuthenticatedOnly } from '../../auth/decorators/authenticated-only.decorator';
import { PlatformAlertsService } from './platform-alerts.service';
import { PlatformAlertsDto } from './dto/platform-alerts.dto';

/**
 * [75.34] `GET /platform/alerts` — platform SUPER_ADMIN only (`PlatformSuperAdminGuard`:
 * a school-local SUPER_ADMIN gets 403). Answers from Postgres only, so it works while Redis is down.
 */
@ApiTags('platform')
@Controller('platform/alerts')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard, PlatformSuperAdminGuard)
@Roles(UserRole.SUPER_ADMIN)
export class PlatformAlertsController {
  constructor(private readonly service: PlatformAlertsService) {}

  @AuthenticatedOnly()
  @Get()
  @ApiOperation({ summary: 'Open platform alerts (e.g. Redis down). SUPER_ADMIN only.' })
  @ApiOkResponse({ type: PlatformAlertsDto })
  list(): Promise<PlatformAlertsDto> {
    return this.service.listOpen();
  }
}
