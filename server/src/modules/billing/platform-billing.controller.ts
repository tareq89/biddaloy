import {
  Body,
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
import { JwtPayload, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PlatformSuperAdminGuard } from '../auth/guards/platform-super-admin.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedOnly } from '../auth/decorators/authenticated-only.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import {
  GrantSeatsDto,
  ListPlatformSchoolsQueryDto,
  OfflinePaymentDto,
  OfflinePaymentResultDto,
  PlatformSchoolBillingDetailDto,
  PlatformSchoolBillingPageDto,
} from './dto/platform-billing.dto';
import { PlatformBillingService } from './platform-billing.service';

/** Epic 49 W4: the platform SUPER_ADMIN's view of every school's seats, orders and payments. */
@ApiTags('platform')
@ApiTenantAuth()
@Controller('platform/billing')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard, PlatformSuperAdminGuard)
@Roles(UserRole.SUPER_ADMIN)
export class PlatformBillingController {
  constructor(private readonly service: PlatformBillingService) {}

  @AuthenticatedOnly()
  @Get('schools')
  @ApiOperation({
    summary: 'Every school with seats entitled / used, paid-until and pending orders.',
  })
  @ApiOkResponse({ type: PlatformSchoolBillingPageDto })
  list(@Query() query: ListPlatformSchoolsQueryDto) {
    return this.service.listSchools(query);
  }

  @AuthenticatedOnly()
  @Get('schools/:id')
  @ApiOperation({ summary: "One school's entitlement and its orders with the payment method." })
  @ApiOkResponse({ type: PlatformSchoolBillingDetailDto })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.schoolDetail(id);
  }

  @AuthenticatedOnly()
  @Post('orders/:id/offline-payment')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mark a PENDING order paid offline (bank / cash). Audited; a replay changes nothing.',
  })
  @ApiOkResponse({ type: OfflinePaymentResultDto })
  offlinePayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OfflinePaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.recordOfflinePayment(id, dto, user.sub);
  }

  @AuthenticatedOnly()
  @Post('schools/:id/grant')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Grant seats for free (a GRANT order, unit price 0). Audited with the reason; idempotent per key.',
  })
  @ApiOkResponse({ type: PlatformSchoolBillingDetailDto })
  grant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GrantSeatsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.grant(id, dto, user.sub);
  }
}
