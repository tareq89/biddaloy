import {
  Body,
  Controller,
  Get,
  Ip,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, type JwtPayload } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { DenyWhenImpersonating } from '../../auth/decorators/deny-when-impersonating.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { FailClosedWithoutRedis } from '../../../common/rate-limit/app-throttler.guard';
import { SmsBundleCatalogService } from '../catalog/sms-bundle-catalog.service';
import { CreateSmsBundleOrderDto, ListSmsBundleOrdersQueryDto } from './dto/sms-bundle-orders.dto';
import { SmsBundleOrdersService } from './sms-bundle-orders.service';

@ApiTags('sms-bundles')
@ApiTenantAuth()
@Controller('sms-bundles')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class SmsBundleOrdersController {
  constructor(
    private readonly orders: SmsBundleOrdersService,
    private readonly catalog: SmsBundleCatalogService,
  ) {}

  @Get('catalog')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'SMS packages on sale, cheapest first.' })
  @ApiOkResponse({ description: 'SmsPackageDto[]' })
  listCatalog() {
    return this.catalog.listActive();
  }

  @Get('orders')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @ApiOperation({ summary: "The school's SMS orders, newest first." })
  @ApiOkResponse({ description: 'SmsBundleOrderViewDto[]' })
  list(@CurrentTenant() tenant: { id: string }, @Query() q: ListSmsBundleOrdersQueryDto) {
    return this.orders.list(tenant.id, q.limit ?? 20, q.offset ?? 0);
  }

  @Get('orders/:id')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @ApiOperation({ summary: "One of this school's SMS orders." })
  @ApiOkResponse({ description: 'SmsBundleOrderViewDto' })
  get(@CurrentTenant() tenant: { id: string }, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(tenant.id, id);
  }

  /** PENDING_PAYMENT order only; paying is #3858. Price is the catalog price, never sent. */
  @DenyWhenImpersonating()
  @Post('orders')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @FailClosedWithoutRedis()
  @ApiOperation({ summary: 'Order one SMS package: idempotent per key.' })
  @ApiCreatedResponse({ description: 'SmsBundleOrderViewDto' })
  create(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSmsBundleOrderDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.orders.create({
      schoolId: tenant.id,
      userId: user.sub,
      packageId: dto.package_id,
      idempotencyKey: dto.idempotency_key,
      ip,
      userAgent: userAgent ?? null,
    });
  }
}
