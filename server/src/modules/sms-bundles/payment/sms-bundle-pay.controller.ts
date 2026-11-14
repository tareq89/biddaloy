import { Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { DenyWhenImpersonating } from '../../auth/decorators/deny-when-impersonating.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { FailClosedWithoutRedis } from '../../../common/rate-limit/app-throttler.guard';
import { BkashPayResponseDto } from '../../billing/bkash/bkash.controller';
import { BkashService } from '../../billing/bkash/bkash.service';

@ApiTags('sms-bundles')
@ApiTenantAuth()
@Controller('sms-bundles')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class SmsBundlePayController {
  constructor(private readonly bkash: BkashService) {}

  /** Another school's order is a 404, a non-PENDING_PAYMENT one a 409 (both fixed sentences). */
  @DenyWhenImpersonating()
  @Post('orders/:id/pay/bkash')
  @HttpCode(200)
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @FailClosedWithoutRedis()
  @ApiOperation({ summary: 'Pay an SMS package order with bKash: returns the checkout URL.' })
  @ApiOkResponse({ type: BkashPayResponseDto })
  payWithBkash(
    @CurrentTenant() tenant: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BkashPayResponseDto> {
    return this.bkash.startPayment(tenant.id, id, 'BUNDLE');
  }
}
