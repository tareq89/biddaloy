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
import { JwtPayload, Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { AttentionQueryService } from './attention-query.service';
import {
  AlertItemDto,
  AlertItemsPageDto,
  AttentionSummaryDto,
  SeenResultDto,
  StudentAlertDto,
} from './dto/alert-item.dto';
import {
  ItemsQueryDto,
  LocaleQueryDto,
  SeenDto,
  SnoozeDto,
  SummaryQueryDto,
} from './dto/attention-query.dto';

type Tenant = { id: string; role: string };

/** [67.1.07] No @Roles: every role reads its own items; PermissionsGuard + user_id scoping decide. */
@ApiTags('attention')
@ApiTenantAuth()
@Controller('attention')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class AttentionController {
  constructor(private readonly attention: AttentionQueryService) {}

  @Get('summary')
  @ApiOperation({ summary: "The caller's attention bar counts and top item." })
  @ApiOkResponse({ type: AttentionSummaryDto })
  summary(
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Query() query: SummaryQueryDto,
  ) {
    return this.attention.summary(tenant.id, user.sub, tenant.role, query);
  }

  @Get('items')
  @ApiOperation({ summary: "The caller's alert worklist (tab=active) or history." })
  @ApiOkResponse({ type: AlertItemsPageDto })
  items(
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Query() query: ItemsQueryDto,
  ) {
    return this.attention.items(tenant.id, user.sub, tenant.role, query);
  }

  @Post('items/seen')
  @HttpCode(200)
  @ApiOperation({ summary: "Mark the caller's own items as seen." })
  @ApiOkResponse({ type: SeenResultDto })
  seen(@CurrentTenant() tenant: Tenant, @CurrentUser() user: JwtPayload, @Body() dto: SeenDto) {
    return this.attention.markSeen(tenant.id, user.sub, dto.recipientIds);
  }

  @Post('items/:recipientId/hide')
  @HttpCode(200)
  @ApiOperation({ summary: "Close (hide) one of the caller's non-critical items." })
  @ApiOkResponse({ type: AlertItemDto })
  hide(
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Param('recipientId', ParseUUIDPipe) recipientId: string,
    @Query() query: LocaleQueryDto,
  ) {
    return this.attention.hide(tenant.id, user.sub, recipientId, query.locale);
  }

  @Post('items/:recipientId/snooze')
  @HttpCode(200)
  @ApiOperation({ summary: "Snooze one of the caller's non-critical items." })
  @ApiOkResponse({ type: AlertItemDto })
  snooze(
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Param('recipientId', ParseUUIDPipe) recipientId: string,
    @Body() dto: SnoozeDto,
    @Query() query: LocaleQueryDto,
  ) {
    return this.attention.snooze(tenant.id, user.sub, recipientId, dto, new Date(), query.locale);
  }

  @Get('students/:studentId')
  @RequirePermissions(Permission.STUDENT_READ)
  @ApiOperation({ summary: 'Open alerts about one student (staff with student scope).' })
  @ApiOkResponse({ type: [StudentAlertDto] })
  student(
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: LocaleQueryDto,
  ) {
    return this.attention.studentAlerts(
      tenant.id,
      { userId: user.sub, role: tenant.role },
      studentId,
      query.locale,
    );
  }
}
