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
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtPayload, Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { PrintCaller, PrintJobsService } from './print-jobs.service';
import { CreatePrintJobDto, PreviewPrintJobDto } from './dto/print-job.dto';
import { ConfirmPrintJobDto, ReprintPrintJobDto } from './dto/print-history.dto';
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
  constructor(private readonly service: PrintJobsService) {}

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
