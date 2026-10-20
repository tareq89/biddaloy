import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import {
  Permission,
  type BillingSummary,
  type JwtPayload,
  type SeatOrderDto,
} from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AllowWhenSuspendedForBilling } from '../auth/decorators/allow-when-suspended-for-billing.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { FailClosedWithoutRedis } from '../../common/rate-limit/app-throttler.guard';
import { billingFreeUntil } from '../../config/env.validation';
import { getSeatUsage } from '../schools/trial/seat-limit.service';
import { EntitlementService } from './entitlement.service';
import { BkashPayResponseDto } from './bkash/bkash.controller';
import { BkashService } from './bkash/bkash.service';
import { OrdersService } from './orders.service';
import { ReceiptService } from './receipt.service';
import { readOnlyUntilFor } from './seat-grace';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';

@ApiTags('billing')
@ApiTenantAuth()
@Controller('billing')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class BillingController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly entitlement: EntitlementService,
    private readonly orders: OrdersService,
    private readonly bkash: BkashService,
    private readonly receipts: ReceiptService,
  ) {}

  @Get('summary')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @AllowWhenSuspendedForBilling()
  @ApiOperation({ summary: "The school's seat balance: seats bought, in use, paid-until." })
  @ApiOkResponse({ description: 'BillingSummary' })
  async summary(@CurrentTenant() tenant: { id: string }): Promise<BillingSummary> {
    const m = this.dataSource.manager;
    const [seats_bought, usage, [until], orders, readOnlyUntil] = await Promise.all([
      this.entitlement.paidSeats(m, tenant.id),
      getSeatUsage(m, tenant.id),
      m.query(
        `SELECT (max(period_end) - 1)::text AS paid_until FROM seat_orders
          WHERE school_id = $1 AND status = 'PAID'`,
        [tenant.id],
      ) as Promise<{ paid_until: string | null }[]>,
      this.orders.list(tenant.id, 20),
      readOnlyUntilFor(m, tenant.id),
    ]);
    return {
      free_until: billingFreeUntil().toISOString(),
      seats_bought,
      seats_used: usage.used,
      paid_until: until?.paid_until ?? null,
      read_only_until: readOnlyUntil?.toISOString() ?? null,
      orders,
    };
  }

  @Get('orders')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @AllowWhenSuspendedForBilling()
  @ApiOperation({ summary: "The school's seat orders, newest first." })
  @ApiOkResponse({ description: 'SeatOrderDto[]' })
  list(
    @CurrentTenant() tenant: { id: string },
    @Query() query: ListOrdersQueryDto,
  ): Promise<SeatOrderDto[]> {
    return this.orders.list(tenant.id, query.limit ?? 20, query.offset ?? 0);
  }

  /** The numbered receipt of a PAID order of this school (A4 HTML; the browser saves it as PDF). */
  @Get('orders/:id/receipt')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @AllowWhenSuspendedForBilling()
  @ApiOperation({ summary: 'Download the receipt of a paid seat order.' })
  @ApiOkResponse({ description: 'Receipt HTML' })
  receipt(
    @CurrentTenant() tenant: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<string> {
    return this.receipts.renderForSchool(tenant.id, id);
  }

  /** Starts a bKash payment for a PENDING order of this school; the client redirects to `bkash_url`. */
  @Post('orders/:id/pay/bkash')
  @HttpCode(200)
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @AllowWhenSuspendedForBilling()
  @FailClosedWithoutRedis()
  @ApiOperation({ summary: 'Pay a seat order with bKash: returns the bKash checkout URL.' })
  @ApiOkResponse({ type: BkashPayResponseDto })
  payWithBkash(
    @CurrentTenant() tenant: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BkashPayResponseDto> {
    return this.bkash.startPayment(tenant.id, id);
  }

  /** Creates a PENDING order only; pay it with `orders/:id/pay/bkash`. Price is server-computed, integer paisa. */
  @Post('orders')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @AllowWhenSuspendedForBilling()
  @ApiOperation({ summary: 'Start a seat purchase: a PENDING order, idempotent per key.' })
  @ApiCreatedResponse({ description: 'SeatOrderDto' })
  create(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateOrderDto,
  ): Promise<SeatOrderDto> {
    return this.orders.createPending({
      schoolId: tenant.id,
      seats: dto.seats,
      months: dto.months,
      idempotency_key: dto.idempotency_key,
      userId: user.sub,
    });
  }
}
