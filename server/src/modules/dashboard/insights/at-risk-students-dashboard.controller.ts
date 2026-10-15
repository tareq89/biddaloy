import { Controller, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { DashboardWidgetKey } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { DashboardWidgetRoute } from '../widget-permission.decorator';
import { AtRiskService } from './at-risk.service';
import { AtRiskStudentsWidgetDto, QueryAtRiskStudentsDto } from './dto/at-risk-students-widget.dto';

/** `GET /dashboard/widgets/at-risk-students` (Epic 169 D7/D46). Reads the nightly precompute only. */
@ApiTags('dashboard')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class AtRiskStudentsDashboardController {
  constructor(private readonly atRisk: AtRiskService) {}

  @DashboardWidgetRoute(DashboardWidgetKey.AT_RISK_STUDENTS)
  @ApiOkResponse({ type: AtRiskStudentsWidgetDto })
  atRiskStudents(
    @CurrentTenant() tenant: { id: string },
    @Query() query: QueryAtRiskStudentsDto,
  ): Promise<AtRiskStudentsWidgetDto> {
    return this.atRisk.read(tenant.id, query.limit ?? 5);
  }
}
