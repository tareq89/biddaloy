import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtPayload, Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { SETTINGS_RATE_LIMIT } from '../../../rate-limit';
import { ManualAlertsService } from './manual-alerts.service';
import {
  CreateManualAlertDto,
  ManualAlertDto,
  ManualAlertListDto,
  ManualAlertPreviewDto,
  ManualListQueryDto,
  PreviewManualAlertDto,
} from './dto/manual-alert.dto';

type Tenant = { id: string };

@ApiTags('attention')
@ApiTenantAuth()
@Controller('attention/manual')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
// ALERT_SEND is held by exactly ADMIN and EXECUTIVE (a @Roles here would only duplicate the map)
@RequirePermissions(Permission.ALERT_SEND)
export class ManualAlertsController {
  constructor(private readonly manual: ManualAlertsService) {}

  @Post()
  @Throttle({ default: SETTINGS_RATE_LIMIT })
  @ApiOperation({ summary: 'Send a WARNING or REMINDER alert to a chosen audience.' })
  @ApiCreatedResponse({ type: ManualAlertDto })
  send(
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateManualAlertDto,
  ) {
    return this.manual.send(tenant.id, user.sub, dto);
  }

  // declared before ':id' routes
  @Post('preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'How many people an audience reaches (no write).' })
  @ApiOkResponse({ type: ManualAlertPreviewDto })
  preview(@CurrentTenant() tenant: Tenant, @Body() dto: PreviewManualAlertDto) {
    return this.manual.preview(tenant.id, dto.audience);
  }

  @Get()
  @ApiOperation({ summary: 'Manual alerts this school sent, newest first.' })
  @ApiOkResponse({ type: ManualAlertListDto })
  list(@CurrentTenant() tenant: Tenant, @Query() q: ManualListQueryDto) {
    return this.manual.list(tenant.id, q.page, q.pageSize);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Withdraw a manual alert from every recipient.' })
  withdraw(
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.manual.withdraw(tenant.id, user.sub, id);
  }
}
