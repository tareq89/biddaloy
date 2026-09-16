import { Controller, Get, Header, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Readable } from 'stream';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, UserRole } from '@biddaloy/shared';
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

/** Quotes a CSV field per RFC 4180: wraps in double quotes and doubles any
 * embedded double quote. Every field is quoted, matching Excel's own
 * default export shape. */
function csvField(value: string | number | boolean | null): string {
  const str = value === null || value === undefined ? '' : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

function toCsv(rows: CollectionsCsvRow[]): string {
  const header = [
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
  const lines = [header.map(csvField).join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.date,
        row.invoice_number,
        row.student_name,
        row.payment_method,
        row.transaction_reference,
        row.collector_name,
        row.amount,
        row.discount,
        row.is_reversal ? 'Yes' : 'No',
      ]
        .map(csvField)
        .join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

/**
 * [16.6.2] `GET /reports/collections` (JSON) and
 * `GET /reports/collections.csv` (per-payment CSV export) — both gated by
 * `Permission.REPORT_COLLECTIONS_READ`, granted to ADMIN and ACCOUNTANT
 * only (see `@biddaloy/shared` `ROLE_PERMISSIONS`).
 */
@ApiTags('reports')
@ApiTenantAuth()
@Controller('reports')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly collectionsReport: CollectionsReportService) {}

  @Get('collections')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
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
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.REPORT_COLLECTIONS_READ)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="collections-report.csv"')
  @ApiOperation({ summary: 'Collections report as a per-payment CSV export.' })
  async getCollectionsCsv(
    @Query() query: CollectionsReportQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<StreamableFile> {
    const rows = await this.collectionsReport.getCsvRows(tenant.id, query);
    // UTF-8 BOM so Excel (which otherwise guesses the system codepage)
    // renders Bangla names/reference strings correctly rather than mojibake.
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const body = Buffer.concat([bom, Buffer.from(toCsv(rows), 'utf-8')]);
    return new StreamableFile(Readable.from(body));
  }
}
