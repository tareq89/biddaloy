import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtPayload, Permission, STUDENT_CERTIFICATE_KINDS } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { PrintTemplatesService } from '../templates/print-templates.service';
import { PrintersService } from '../printers/printers.service';
import { PrintAssetsService } from '../assets/print-assets.service';
import { PrintCaller, PrintJobsService } from './print-jobs.service';
import { CreatePrintJobDto, PreviewPrintJobDto } from './dto/print-job.dto';
import {
  CertificateTemplateRowDto,
  CertificateTemplatesQueryDto,
  ConfirmPrintJobDto,
  ReprintPrintJobDto,
} from './dto/print-history.dto';
import { PhotoQueryDto } from './print-jobs.controller';

type Tenant = { id: string; role: string };

/**
 * [48.2.04] The five student certificates (TC, testimonial, character, study,
 * participation). Same service as `/print-jobs`, but gated by CERTIFICATE_ISSUE
 * (EXECUTIVE holds it, not DOCUMENT_PRINT) and refusing every other kind.
 */
@ApiTags('print')
@ApiTenantAuth()
@Controller('certificates')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.CERTIFICATE_ISSUE)
export class CertificatesController {
  constructor(
    private readonly service: PrintJobsService,
    private readonly templates: PrintTemplatesService,
    private readonly printers: PrintersService,
    private readonly assets: PrintAssetsService,
  ) {}

  private caller(tenant: Tenant, user: JwtPayload): PrintCaller {
    return { tenantId: tenant.id, userId: user.sub, role: tenant.role, channel: 'CERTIFICATE' };
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve certificate data for a template + students, no job.' })
  preview(
    @Body() dto: PreviewPrintJobDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.preview(this.caller(tenant, user), dto);
  }

  @Post()
  @ApiOperation({ summary: 'Issue certificates: next serial per student, verify tokens.' })
  create(
    @Body() dto: CreatePrintJobDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.create(this.caller(tenant, user), dto);
  }

  @Patch('jobs/:id/confirm')
  @ApiOperation({ summary: 'Answer "did all N print?" for a certificate job. 409 if confirmed.' })
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmPrintJobDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.confirm(this.caller(tenant, user), id, dto.failed_item_ids);
  }

  @Post('jobs/:id/reprint')
  @ApiOperation({ summary: 'Reprint certificates: same serial, new copy number (DUPLICATE).' })
  reprint(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReprintPrintJobDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.reprint(this.caller(tenant, user), id, dto.item_ids);
  }

  // Reads the issue modal makes (EXECUTIVE holds CERTIFICATE_ISSUE, not DOCUMENT_PRINT).
  // All declared before any `:id` route.
  @Get('templates')
  @ApiOperation({ summary: 'Live, published templates of one certificate kind. Default first.' })
  @ApiOkResponse({ type: [CertificateTemplateRowDto] })
  async templateList(
    @Query() q: CertificateTemplatesQueryDto,
    @CurrentTenant() tenant: Tenant,
  ): Promise<CertificateTemplateRowDto[]> {
    // `list` already drops archived templates; an unpublished one has no current version.
    const rows = await this.templates.list(tenant.id, { document_kind: q.document_kind });
    return rows
      .filter((r): r is typeof r & { current_version_id: string } => !!r.current_version_id)
      .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name))
      .map((r) => ({
        id: r.id,
        name: r.name,
        is_default: r.is_default,
        current_version_id: r.current_version_id,
      }));
  }

  @Get('printers')
  @ApiOperation({ summary: 'Printer profiles (same rows as GET /printers).' })
  printerList(@CurrentTenant() tenant: Tenant) {
    return this.printers.list(tenant.id);
  }

  // Like the family admit-card route: only assets a live certificate template's current
  // version uses, not the whole library (ID-card artwork etc.).
  @Get('assets')
  @ApiOperation({
    summary: 'Print assets used by the current version of a live certificate template.',
  })
  assetList(@CurrentTenant() tenant: Tenant, @Query('kind') kind?: string) {
    return this.assets.listReferenced(tenant.id, STUDENT_CERTIFICATE_KINDS, kind);
  }

  @Get('assets/:id/file')
  @Header('Cache-Control', 'private, max-age=31536000, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  // Uploaded SVG opened directly must not run or load anything.
  @Header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  @ApiOperation({
    summary: 'Stream an asset a live certificate template uses. 404 for any other id.',
  })
  async assetFile(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const used = await this.assets.referencedIds(tenant.id, STUDENT_CERTIFICATE_KINDS);
    if (!used.has(id)) throw new NotFoundException('Print asset not found');
    const { asset, object } = await this.assets.getFile(id, tenant.id);
    res.setHeader('Content-Type', asset.content_type);
    return new StreamableFile(object.body);
  }

  @Get('photo')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Stream a student photo referenced by a certificate item.' })
  async photo(
    @Query() q: PhotoQueryDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const obj = await this.service.photo(
      this.caller(tenant, user),
      q.subject_type,
      q.subject_id,
      q.key,
    );
    if (obj.contentType) res.setHeader('Content-Type', obj.contentType);
    return new StreamableFile(obj.body);
  }
}
