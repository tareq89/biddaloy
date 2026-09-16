import { Controller, Get, Header, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Readable } from 'stream';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, UserRole, toCsvContent } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { CollectionsReportService } from './collections-report.service';
import {
  CollectionsCsvRow,
  CollectionsReportDto,
  CollectionsReportQueryDto,
} from './dto/collections-report.dto';

const CSV_HEADER = [
  'Date',
  'Invoice No',
  'Student',
  'Method',
  'Reference',
  'Collector',
  'Amount',
  'Discount',
  'Reversal',
];

/** Delegates to the shared `toCsvContent` (formula-injection guard + BOM +
 * CRLF) rather than a hand-rolled quoter — `student_name` and
 * `transaction_reference` are user-controlled, and a bare quote/escape
 * implementation here would be the third reimplementation of a mistake
 * that has already shipped once (see `shared/src/sanitize/csv.ts`). */
function toCsv(rows: CollectionsCsvRow[]): string {
  const body = rows.map((row) => [
    row.date,
    row.invoice_number,
    row.student_name,
    row.payment_method,
    row.transaction_reference,
    row.collector_name,
    row.amount,
    row.discount,
    row.is_reversal ? 'Yes' : 'No',
  ]);
  return toCsvContent([CSV_HEADER, ...body]);
}

/**
 * [16.6.2] `GET /reports/collections` (JSON) and
 * `GET /reports/collections.csv` (per-payment CSV export) — both gated by
 * `Permission.REPORT_COLLECTIONS_READ`, granted to ADMIN, ACCOUNTANT and
 * EXECUTIVE (see `@biddaloy/shared` `ROLE_PERMISSIONS` —
 * `permissions.spec.ts` documents EXECUTIVE's grant as existing
 * specifically for this report).
 */
@ApiTags('reports')
@ApiTenantAuth()
@Controller('reports')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly collectionsReport: CollectionsReportService) {}

  @Get('collections')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @RequirePermissions(Permission.REPORT_COLLECTIONS_READ)
  @ApiOperation({ summary: 'Collections report: totals, by method/collector/fee-type/day.' })
  @ApiOkResponse({ type: CollectionsReportDto })
  async getCollections(
    @Query() query: CollectionsReportQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<CollectionsReportDto> {
    return this.collectionsReport.getReport(tenant.id, query);
  }

  @Get('collections.csv')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @RequirePermissions(Permission.REPORT_COLLECTIONS_READ)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="collections-report.csv"')
  @ApiOperation({ summary: 'Collections report as a per-payment CSV export.' })
  async getCollectionsCsv(
    @Query() query: CollectionsReportQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<StreamableFile> {
    const rows = await this.collectionsReport.getCsvRows(tenant.id, query);
    // toCsvContent already prefixes the UTF-8 BOM (so Excel renders Bangla
    // names/reference strings correctly instead of mojibake) and CRLF-joins.
    const body = Buffer.from(toCsv(rows), 'utf-8');
    return new StreamableFile(Readable.from(body));
  }
}
