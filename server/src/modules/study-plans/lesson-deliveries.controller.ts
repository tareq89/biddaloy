import { Body, Controller, Get, HttpCode, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtPayload, Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { StudyPlanCaller } from './study-plans.service';
import { LessonDeliveriesService } from './lesson-deliveries.service';
import {
  ExtraLessonDeliveryDto,
  LessonDeliveriesDayDto,
  ListLessonDeliveriesQueryDto,
  PutLessonDeliveryDto,
  SavedLessonDeliveryDto,
  TodayAllTaughtResponseDto,
} from './dto/lesson-delivery.dto';

type Tenant = { id: string; role: string };

/**
 * [66.2.03/#2008] The teacher's daily log. Permissions only say "may use the
 * feature"; owner / substitute / 7-day rules live in `LessonDeliveriesService`.
 * Literal paths only, so no `:id` shadowing.
 */
@ApiTags('lesson-deliveries')
@ApiTenantAuth()
@Controller('lesson-deliveries')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class LessonDeliveriesController {
  constructor(private readonly service: LessonDeliveriesService) {}

  private caller(tenant: Tenant, user: JwtPayload, request: Request): StudyPlanCaller {
    return {
      userId: user.sub,
      tenantId: tenant.id,
      role: tenant.role,
      context: requestContext(request),
    };
  }

  @Get()
  @RequirePermissions(Permission.SYLLABUS_READ)
  @ApiOperation({ summary: "The caller's periods for a date with planned lesson and delivery." })
  @ApiOkResponse({ type: LessonDeliveriesDayDto })
  day(
    @Query() query: ListLessonDeliveriesQueryDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.day(query.date, tenant.id, this.caller(tenant, user, request));
  }

  @Put()
  @RequirePermissions(Permission.SYLLABUS_MANAGE)
  @ApiOperation({ summary: 'Record taught / partly / not taught for one period (upsert).' })
  @ApiOkResponse({ type: SavedLessonDeliveryDto })
  put(
    @Body() dto: PutLessonDeliveryDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.put(dto, tenant.id, this.caller(tenant, user, request));
  }

  @Post('today-all-taught')
  @HttpCode(200)
  @RequirePermissions(Permission.SYLLABUS_MANAGE)
  @ApiOperation({ summary: "Mark today's unmarked, planned, non-cancelled periods taught." })
  @ApiOkResponse({ type: TodayAllTaughtResponseDto })
  todayAllTaught(
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.markAllTaught(tenant.id, this.caller(tenant, user, request));
  }

  @Post('extra')
  @RequirePermissions(Permission.SYLLABUS_MANAGE)
  @ApiOperation({ summary: 'Log an extra class (always TAUGHT).' })
  @ApiOkResponse({ type: SavedLessonDeliveryDto })
  extra(
    @Body() dto: ExtraLessonDeliveryDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.extra(dto, tenant.id, this.caller(tenant, user, request));
  }
}
