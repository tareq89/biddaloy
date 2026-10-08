import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Readable } from 'stream';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtPayload, Permission, toCsvContent } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { PrintJobsService } from './print-jobs.service';
import { PrintHistoryService } from './print-history.service';
import {
  ConfirmPrintJobDto,
  QueryPrintHistoryDto,
  QueryRegisterDto,
  ReprintPrintJobDto,
  RevokePrintItemDto,
  SubjectHistoryQueryDto,
} from './dto/print-history.dto';

// en-CA formats as YYYY-MM-DD.
const dhakaDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' });

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
  @RequirePermissions(Permission.PRINT_HISTORY_READ)
  @ApiOperation({ summary: 'Search the print history. Rows never carry the data snapshot.' })
  list(
    @Query() q: QueryPrintHistoryDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.history.list(caller(tenant, user), q);
  }

  // Declared before `items/:id`.
  @Get('queue')
  @RequirePermissions(Permission.DOCUMENT_PRINT)
  @ApiOperation({
    summary: 'What is still to print: counts per kind and exams with missing admit cards.',
  })
  queue(@CurrentTenant() tenant: Tenant, @CurrentUser() user: JwtPayload) {
    return this.history.queue(caller(tenant, user));
  }

  // Declared before `items/:id`.
  @Get('register')
  @RequirePermissions(Permission.PRINT_HISTORY_READ)
  @ApiOperation({
    summary: 'Certificate register: every serial-numbered copy, revoked ones included.',
  })
  register(
    @Query() q: QueryRegisterDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.history.register(caller(tenant, user), q);
  }

  @Get('register.csv')
  @RequirePermissions(Permission.PRINT_HISTORY_READ)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="certificate-register.csv"')
  @ApiOperation({ summary: 'Certificate register as CSV (max 10 000 rows).' })
  async registerCsv(
    @Query() q: QueryRegisterDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ): Promise<StreamableFile> {
    const rows = await this.history.registerCsvRows(caller(tenant, user), q);
    const day = (d: Date | null) => (d ? dhakaDay.format(new Date(d)) : '');
    const csv = toCsvContent([
      [
        'Serial',
        'Copy',
        'Document',
        'Student',
        'Class',
        'Issued on',
        'Issued by',
        'Status',
        'Revoked on',
        'Revoke reason',
      ],
      ...rows.map((r: any) => [
        r.serial,
        r.copy_number,
        r.document_kind,
        r.subject_label,
        r.class_name ?? '',
        day(r.issued_at),
        r.printed_by_name ?? '',
        r.revoked_at ? 'Revoked' : 'Valid',
        day(r.revoked_at),
        r.revoke_reason ?? '',
      ]),
    ]);
    return new StreamableFile(Readable.from(Buffer.from(csv, 'utf-8')));
  }

  @Get('items/:id')
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
