import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AuthenticatedOnly } from '../../auth/decorators/authenticated-only.decorator';
import { PlatformAlertsService } from './platform-alerts.service';
import { PlatformAlertsDto } from './dto/platform-alerts.dto';

/**
 * [75.34] `GET /platform/alerts` — SUPER_ADMIN only, same guard chain as
 * `PlatformAttentionHealthController`. Answers from Postgres only, so it works while Redis is down.
 */
@ApiTags('platform')
@Controller('platform/alerts')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
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
