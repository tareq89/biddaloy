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
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtPayload, Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { PrintJobsService } from './print-jobs.service';
import { PrintHistoryService } from './print-history.service';
import {
  ConfirmPrintJobDto,
  QueryPrintHistoryDto,
  ReprintPrintJobDto,
  RevokePrintItemDto,
  SubjectHistoryQueryDto,
} from './dto/print-history.dto';

type Tenant = { id: string; role: string };
const caller = (tenant: Tenant, user: JwtPayload) => ({
  tenantId: tenant.id,
  userId: user.sub,
  role: tenant.role,
});

/** D25 / D59 — closing out and repeating a print job. Same guards as printing. */
@ApiTags('print')
@ApiTenantAuth()
@Controller('print-jobs')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
@RequirePermissions(Permission.DOCUMENT_PRINT)
export class PrintJobActionsController {
  constructor(
    private readonly jobs: PrintJobsService,
    private readonly history: PrintHistoryService,
  ) {}

  // Declared before the `:id` routes so `subject-history` is never read as an id.
  @Get('subject-history')
  @ApiOperation({ summary: 'Print history of one student / staff member (newest first, max 100).' })
  subjectHistory(
    @Query() q: SubjectHistoryQueryDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.history.subjectHistory(caller(tenant, user), q.subject_type, q.subject_id);
  }

  @Patch(':id/confirm')
  @ApiOperation({
    summary: 'Answer "did all N print?": mark failed items, the rest OK. 409 if already confirmed.',
  })
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmPrintJobDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.jobs.confirm(caller(tenant, user), id, dto.failed_item_ids);
  }

  @Post(':id/reprint')
  @ApiOperation({
    summary: 'Reprint items exactly: same version and data, new copy number and verify token.',
  })
  reprint(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReprintPrintJobDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.jobs.reprint(caller(tenant, user), id, dto.item_ids);
  }
}

/** D9 / D22 / D47 — the searchable print trail. Reading it is ADMIN + EXECUTIVE only. */
@ApiTags('print')
@ApiTenantAuth()
@Controller('print-history')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class PrintHistoryController {
  constructor(private readonly history: PrintHistoryService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @RequirePermissions(Permission.PRINT_HISTORY_READ)
  @ApiOperation({ summary: 'Search the print history. Rows never carry the data snapshot.' })
  list(
    @Query() q: QueryPrintHistoryDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.history.list(caller(tenant, user), q);
  }

  @Get('items/:id')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @RequirePermissions(Permission.PRINT_HISTORY_READ)
  @ApiOperation({
    summary: 'One printed item with its snapshot and template definition, to re-render it.',
  })
  item(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.history.getItem(caller(tenant, user), id);
  }

  @Post('items/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.DOCUMENT_REVOKE)
  @ApiOperation({ summary: 'Revoke one printed copy (ADMIN only). 409 if already revoked.' })
  revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevokePrintItemDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.history.revoke(caller(tenant, user), id, dto.reason);
  }
}
