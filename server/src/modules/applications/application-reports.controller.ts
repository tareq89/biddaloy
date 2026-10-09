import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { ApplicationReportsService } from './application-reports.service';
import { ApplicationReportsDto, PendingCountDto, ReportsQueryDto } from './dto/reports.dto';

type Tenant = { id: string; role: UserRole };
type Actor = { sub: string };

/**
 * Literal paths; this controller registers before ApplicationsController so they beat
 * `GET /applications/:id` (see applications.module.ts).
 */
@ApiTags('applications')
@ApiTenantAuth()
@Controller('applications')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ApplicationReportsController {
  constructor(private readonly service: ApplicationReportsService) {}

  @Get('pending-count')
  @RequirePermissions(Permission.APPLICATION_SUBMIT)
  @ApiOperation({ summary: "The caller's inbox count: exactly what view=inbox lists" })
  @ApiOkResponse({ type: PendingCountDto })
  pendingCount(
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: Actor,
  ): Promise<PendingCountDto> {
    return this.service.pendingCount(tenant.id, { userId: user.sub, role: tenant.role });
  }

  @Get('reports')
  @RequirePermissions(Permission.APPLICATION_MANAGE)
  @ApiOperation({ summary: 'Counts, timings, stale list, who is on leave today, staff leave days' })
  @ApiOkResponse({ type: ApplicationReportsDto })
  reports(
    @Query() query: ReportsQueryDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: Actor,
  ): Promise<ApplicationReportsDto> {
    return this.service.reports(tenant.id, { userId: user.sub, role: tenant.role }, query);
  }
}
