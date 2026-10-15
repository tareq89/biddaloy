import { Controller, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { DashboardWidgetKey } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { DashboardWidgetRoute } from '../dashboard/widget-permission.decorator';
import { AdmissionDashboardService } from './admission-dashboard.service';
import { AdmissionsTodayDto } from './dto/admission-dashboard.dto';

@ApiTags('dashboard')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class AdmissionDashboardController {
  constructor(private readonly service: AdmissionDashboardService) {}

  @DashboardWidgetRoute(DashboardWidgetKey.ADMISSIONS_TODAY)
  @ApiOkResponse({ type: AdmissionsTodayDto })
  getAdmissionsToday(@CurrentTenant() tenant: { id: string }): Promise<AdmissionsTodayDto> {
    return this.service.getAdmissionsToday(tenant.id);
  }
}
