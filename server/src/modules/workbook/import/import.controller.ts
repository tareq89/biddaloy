import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { UserRole, Permission, JwtPayload, toCsvContent } from '@biddaloy/shared';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { STRICT_RATE_LIMIT } from '../../../rate-limit';
import { ImportStagingService } from '../../bulk-import/import-staging.service';
import type { BulkImportErrorDto } from '../../bulk-import/dto/bulk-import.dto';
import { StorageService } from '../../storage/storage.service';
import { tenantObjectKeyNamed } from '../../storage/storage-key';
import { WorkbookFormatError } from '../codec/workbook-codec';
import type { RowError } from '../codec/tab-spec';
import type { WorkbookMeta } from '../codec/meta';
import { ValidationService } from './validation.service';
import { DiffService } from './diff.service';
import type { ValidateResponseDto } from './dto/validate-response.dto';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

/** Category for the original upload, kept only long enough for a restore
 * to consume it — separate from `export`'s `'backups'` category so the two
 * lifecycles (30-minute staging TTL vs 30-day retention) are never confused
 * by a shared prefix. */
const STAGING_STORAGE_CATEGORY = 'staging';

/**
 * What `POST /backup/validate` stages, so `GET .../errors.csv` can re-read
 * the same errors later without re-parsing the workbook, and so a restore
 * can re-validate the *original* upload against the tenant's current data
 * once the admin confirms.
 *
 * Only the workbook's storage key is staged, not its parsed rows: a large
 * school's workbook can be tens of thousands of rows across 18 tabs, which
 * is too large to hold in Redis (`ImportStagingService`'s backing store) for
 * every in-flight validation. The buffer itself lives in object storage;
 * restore downloads it and calls `ValidationService.validate` again to get
 * fresh, real typed rows — the same call this controller already makes,
 * just re-run at apply time instead of reused from preview time.
 */
export interface StagedValidation {
  workbook_storage_key: string;
  meta: WorkbookMeta;
  tabs: Array<{
    name: string;
    present: boolean;
    creates: number;
    updates: number;
    unchanged: number;
    deletes: number;
  }>;
  totals: { creates: number; updates: number; unchanged: number; deletes: number };
  hardErrorCount: number;
  isEmptyTenant: boolean;
  errors: BulkImportErrorDto[];
  /** Non-fatal, but some change what a restore does — most importantly
   * "sheet <tab> not present", which means delete-by-absence is skipped for
   * that tab. The admin confirms the restore from this preview, so these
   * cannot be dropped. */
  warnings: BulkImportErrorDto[];
}

function toErrorDto(e: RowError): BulkImportErrorDto {
  return {
    row: e.row,
    column: e.column,
    message: e.message,
    severity: e.severity,
    value: e.value,
    tab: e.tab,
  };
}

/**
 * Upload -> validate -> diff -> staged under an id -> preview JSON. Nothing
 * is written to tenant data by this controller — the actual restore is a
 * separate, later endpoint (out of scope for this ticket) that consumes the
 * staged payload.
 */
@ApiTags('backup')
@ApiTenantAuth()
@Controller('backup')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ImportController {
  constructor(
    @Inject(ValidationService) private readonly validationService: ValidationService,
    @Inject(DiffService) private readonly diffService: DiffService,
    @Inject(ImportStagingService) private readonly staging: ImportStagingService,
    @Inject(StorageService) private readonly storage: StorageService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Post('validate')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @RequirePermissions(Permission.BACKUP_MANAGE)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @ApiConsumes('multipart/form-data')
  // Without an explicit body schema the generated client types this endpoint
  // as `requestBody?: never`, which is wrong and unusable from `ui`.
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'The .xlsx workbook to validate.' },
      },
    },
  })
  @ApiOperation({ summary: 'Validate an uploaded backup workbook and stage the dry-run preview.' })
  async validate(
    @UploadedFile() file: Express.Multer.File,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ): Promise<ValidateResponseDto> {
    if (!file) {
      throw new BadRequestException('A file is required.');
    }
    if (!file.originalname.toLowerCase().endsWith('.xlsx')) {
      throw new BadRequestException('Only .xlsx files are accepted.');
    }

    let validated;
    try {
      validated = await this.validationService.validate(
        file.buffer,
        tenant.id,
        this.dataSource.manager,
      );
    } catch (error) {
      if (error instanceof WorkbookFormatError) {
        throw new BadRequestException({ code: error.code, message: error.message });
      }
      throw error;
    }

    const diffReport = await this.diffService.diff(validated, tenant.id, this.dataSource.manager);

    const errorDtos = validated.errors.map(toErrorDto);
    const warningDtos = validated.warnings.map(toErrorDto);

    // The original upload, kept only so a later restore can re-validate it
    // once the admin confirms — see StagedValidation's doc comment for why
    // the parsed rows themselves are never staged. Named by a fresh id, not
    // the staging id: `ImportStagingService.stage` mints its own id and
    // gives no way to choose it ahead of time.
    const workbookStorageKey = tenantObjectKeyNamed(
      tenant.id,
      STAGING_STORAGE_CATEGORY,
      randomUUID(),
      'xlsx',
    );
    await this.storage.put(
      workbookStorageKey,
      file.buffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    const staged: StagedValidation = {
      workbook_storage_key: workbookStorageKey,
      meta: validated.meta,
      tabs: diffReport.tabs.map((t) => ({
        name: t.name,
        present: t.present,
        creates: t.creates,
        updates: t.updates,
        unchanged: t.unchanged,
        deletes: t.deletes,
      })),
      totals: diffReport.totals,
      hardErrorCount: diffReport.hardErrorCount,
      isEmptyTenant: diffReport.isEmptyTenant,
      errors: errorDtos,
      warnings: warningDtos,
    };

    const { stagingId, expiresAt } = await this.staging.stage(tenant.id, user.sub, staged);

    return {
      staging_id: stagingId,
      expires_at: expiresAt,
      meta: validated.meta,
      tabs: staged.tabs,
      totals: staged.totals,
      errors: errorDtos,
      warnings: warningDtos,
      hard_error_count: staged.hardErrorCount,
      is_empty_tenant: staged.isEmptyTenant,
    };
  }

  @Get('validate/:stagingId/errors.csv')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @RequirePermissions(Permission.BACKUP_MANAGE)
  // Same budget as the validate call this replays: a staging id stays
  // readable for its 30-minute TTL, so the download deserves the limit too.
  @Throttle({ default: STRICT_RATE_LIMIT })
  // The report carries tenant data, and the staging id is guessable for the
  // length of its TTL — same reason `workbook.controller.ts` marks the backup
  // download `no-store`. Keeps it out of shared/browser caches.
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Download the error list of a staged validation as CSV.' })
  @ApiResponse({
    status: 200,
    description: 'The staged validation errors and warnings as CSV.',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  async errorsCsv(
    @Param('stagingId') stagingId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ): Promise<void> {
    // `peek`, not `consume`: downloading the error CSV must not burn the
    // single use a later commit step needs.
    const staged = await this.staging.peek<StagedValidation>(tenant.id, user.sub, stagingId);
    if (!staged) {
      throw new NotFoundException('No staged validation found for this id.');
    }

    // `toCsvContent` (shared) guards against CSV injection and emits the
    // UTF-8 BOM. Both matter here: every value below is echoed straight from
    // an uploaded workbook, so a cell like `=HYPERLINK("http://evil","x")`
    // would execute when the admin opens the report in Excel, and Bangla
    // error values mangle without the BOM.
    const rows: unknown[][] = [
      ['tab', 'row', 'column', 'severity', 'message', 'value'],
      // Warnings included: severity is a column, and the "sheet not
      // present" notice is the one line an admin most needs to see.
      ...[...staged.errors, ...(staged.warnings ?? [])].map((e) => [
        e.tab ?? '',
        e.row,
        e.column ?? '',
        e.severity,
        e.message,
        e.value ?? '',
      ]),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="backup-validation-${stagingId}.csv"`,
    );
    res.send(toCsvContent(rows));
  }
}
