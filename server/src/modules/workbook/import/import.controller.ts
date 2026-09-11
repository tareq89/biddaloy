import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { UserRole, Permission, JwtPayload } from '@biddaloy/shared';
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
import { WorkbookFormatError } from '../codec/workbook-codec';
import type { RowError } from '../codec/tab-spec';
import type { WorkbookMeta } from '../codec/meta';
import { ValidationService } from './validation.service';
import { DiffService } from './diff.service';
import type { ValidateResponseDto } from './dto/validate-response.dto';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * What `POST /backup/validate` stages, so `GET .../errors.csv` can re-read
 * the same errors later without re-parsing the workbook.
 */
export interface StagedValidation {
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

function csvField(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Post('validate')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @RequirePermissions(Permission.BACKUP_MANAGE)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @ApiConsumes('multipart/form-data')
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

    const staged: StagedValidation = {
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
    };

    const { stagingId, expiresAt } = await this.staging.stage(tenant.id, user.sub, staged);

    return {
      staging_id: stagingId,
      expires_at: expiresAt,
      meta: validated.meta,
      tabs: staged.tabs,
      totals: staged.totals,
      errors: errorDtos,
      hard_error_count: staged.hardErrorCount,
      is_empty_tenant: staged.isEmptyTenant,
    };
  }

  @Get('validate/:stagingId/errors.csv')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @RequirePermissions(Permission.BACKUP_MANAGE)
  @ApiOperation({ summary: 'Download the error list of a staged validation as CSV.' })
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

    const header = 'tab,row,column,severity,message,value';
    const lines = staged.errors.map((e) =>
      [
        csvField(e.tab ?? ''),
        csvField(e.row),
        csvField(e.column ?? ''),
        csvField(e.severity),
        csvField(e.message),
        csvField(e.value ?? ''),
      ].join(','),
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="backup-validation-${stagingId}.csv"`,
    );
    res.send([header, ...lines].join('\n'));
  }
}
