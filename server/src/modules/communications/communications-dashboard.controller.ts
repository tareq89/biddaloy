import { Controller, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { DashboardWidgetKey } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { DashboardWidgetRoute } from '../dashboard/widget-permission.decorator';
import { CommunicationsDashboardService } from './communications-dashboard.service';
import { FailedMessagesWidgetDto, SmsBalanceWidgetDto } from './dto/communications-dashboard.dto';

@ApiTags('dashboard')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class CommunicationsDashboardController {
  constructor(private readonly service: CommunicationsDashboardService) {}

  @DashboardWidgetRoute(DashboardWidgetKey.SMS_BALANCE)
  @ApiOkResponse({ type: SmsBalanceWidgetDto })
  getSmsBalance(@CurrentTenant() tenant: { id: string }): Promise<SmsBalanceWidgetDto> {
    return this.service.getSmsBalance(tenant.id);
  }

  @DashboardWidgetRoute(DashboardWidgetKey.FAILED_MESSAGES)
  @ApiOkResponse({ type: FailedMessagesWidgetDto })
  getFailedMessages(@CurrentTenant() tenant: { id: string }): Promise<FailedMessagesWidgetDto> {
    return this.service.getFailedMessages(tenant.id);
  }
}
