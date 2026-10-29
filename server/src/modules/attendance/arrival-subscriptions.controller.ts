import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Permission, UserRole, roleHasPermission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AuthenticatedOnly } from '../auth/decorators/authenticated-only.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { ArrivalSubscriptionsService } from './arrival-subscriptions.service';
import {
  ArrivalSubscriptionResponseDto,
  CreateArrivalSubscriptionDto,
  LockArrivalSubscriptionDto,
  MyArrivalSubscriptionsDto,
  QueryArrivalSubscriptionsDto,
  StaffArrivalSubscriptionDto,
  UpdateArrivalSubscriptionDto,
  UpsertMyArrivalSubscriptionDto,
} from './dto/arrival-subscription.dto';

type Tenant = { id: string; role: string };
type User = { sub: string };

const actor = (tenant: Tenant, user: User) => ({
  tenantId: tenant.id,
  userId: user.sub,
  role: tenant.role,
  canLock: roleHasPermission(tenant.role, Permission.ATTENDANCE_ARRIVAL_NOTICE_LOCK),
});

/** Staff side (D15/D16/D36). A TEACHER is limited to homeroom sections inside the service. */
@ApiTags('attendance')
@ApiTenantAuth()
@Controller('attendance/arrival-subscriptions')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ArrivalSubscriptionsController {
  constructor(private readonly service: ArrivalSubscriptionsService) {}

  @Get()
  @RequirePermissions(Permission.ATTENDANCE_ARRIVAL_NOTICE_MANAGE)
  @ApiOperation({ summary: 'Arrival-notice subscriptions, optionally by section and status.' })
  @ApiOkResponse({ type: StaffArrivalSubscriptionDto, isArray: true })
  list(
    @Query() query: QueryArrivalSubscriptionsDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: User,
  ) {
    return this.service.listForStaff(actor(tenant, user), query);
  }

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  @RequirePermissions(Permission.ATTENDANCE_ARRIVAL_NOTICE_MANAGE)
  @ApiOperation({ summary: 'Adds a subscription for a guardian; ACTIVE at once.' })
  @ApiCreatedResponse({ type: ArrivalSubscriptionResponseDto })
  create(
    @Body() dto: CreateArrivalSubscriptionDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: User,
  ) {
    return this.service.createByStaff(actor(tenant, user), dto);
  }

  @Patch(':id')
  @UseInterceptors(IdempotencyInterceptor)
  @RequirePermissions(Permission.ATTENDANCE_ARRIVAL_NOTICE_MANAGE)
  @ApiOperation({ summary: 'Confirm, decline, switch off, or change the mode.' })
  @ApiOkResponse({ type: ArrivalSubscriptionResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateArrivalSubscriptionDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: User,
  ) {
    return this.service.update(actor(tenant, user), id, dto);
  }

  @Patch(':id/lock')
  @UseInterceptors(IdempotencyInterceptor)
  @RequirePermissions(Permission.ATTENDANCE_ARRIVAL_NOTICE_LOCK)
  @ApiOperation({ summary: 'Forces a subscription always on, never on, or clears the lock.' })
  @ApiOkResponse({ type: ArrivalSubscriptionResponseDto })
  lock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LockArrivalSubscriptionDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: User,
  ) {
    return this.service.setLock(actor(tenant, user), id, dto.lock);
  }
}

/** Portal side: a guardian's own children only. */
@ApiTags('portal')
@ApiTenantAuth()
@Controller('portal/arrival-subscriptions')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class PortalArrivalSubscriptionsController {
  constructor(private readonly service: ArrivalSubscriptionsService) {}

  @AuthenticatedOnly()
  @Get()
  @Roles(UserRole.PARENT)
  @ApiOperation({ summary: "The caller's linked children with their subscription, if any." })
  @ApiOkResponse({ type: MyArrivalSubscriptionsDto })
  mine(@CurrentTenant() tenant: Tenant, @CurrentUser() user: User) {
    return this.service.getMine(tenant.id, user.sub);
  }

  @AuthenticatedOnly()
  @Put(':studentId')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyInterceptor)
  @Roles(UserRole.PARENT)
  @ApiOperation({ summary: 'Request (want=true) or switch off (want=false) arrival notices.' })
  // null = switched off a subscription that never existed.
  @ApiOkResponse({
    schema: { nullable: true, allOf: [{ $ref: getSchemaPath(ArrivalSubscriptionResponseDto) }] },
  })
  upsert(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: UpsertMyArrivalSubscriptionDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: User,
  ) {
    return this.service.upsertByGuardian({
      tenantId: tenant.id,
      guardianUserId: user.sub,
      studentId,
      want: dto.want,
      channel: dto.channel,
    });
  }
}
