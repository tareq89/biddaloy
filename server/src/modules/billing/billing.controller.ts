import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Permission, type BillingSummary, type SeatOrderDto } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { billingFreeUntil } from '../../config/env.validation';
import { getSeatUsage } from '../schools/trial/seat-limit.service';
import { EntitlementService } from './entitlement.service';
import { OrdersService } from './orders.service';
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
  ) {}

  @Get('summary')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @ApiOperation({ summary: "The school's seat balance: seats bought, in use, paid-until." })
  @ApiOkResponse({ description: 'BillingSummary' })
  async summary(@CurrentTenant() tenant: { id: string }): Promise<BillingSummary> {
    const m = this.dataSource.manager;
    const [seats_bought, usage, [until], orders] = await Promise.all([
      this.entitlement.paidSeats(m, tenant.id),
      getSeatUsage(m, tenant.id),
      // The school's own orders set paid-until; a GRANT (unit price 0) only when it has no own order.
      m.query(
        `SELECT (COALESCE(max(period_end) FILTER (WHERE unit_price_paisa > 0), max(period_end)) - 1)::text
                AS paid_until
           FROM seat_orders WHERE school_id = $1 AND status = 'PAID'`,
        [tenant.id],
      ) as Promise<{ paid_until: string | null }[]>,
      this.orders.list(tenant.id, 20),
    ]);
    return {
      free_until: billingFreeUntil().toISOString(),
      seats_bought,
      seats_used: usage.used,
      paid_until: until?.paid_until ?? null,
      orders,
    };
  }

  @Get('orders')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @ApiOperation({ summary: "The school's seat orders, newest first." })
  @ApiOkResponse({ description: 'SeatOrderDto[]' })
  list(
    @CurrentTenant() tenant: { id: string },
    @Query() query: ListOrdersQueryDto,
  ): Promise<SeatOrderDto[]> {
    return this.orders.list(tenant.id, query.limit ?? 20, query.offset ?? 0);
  }
}
