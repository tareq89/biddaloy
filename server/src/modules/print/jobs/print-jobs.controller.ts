import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID } from 'class-validator';
import type { Response } from 'express';
import { JwtPayload, Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { PrintJobsService } from './print-jobs.service';
import { CreatePrintJobDto, PreviewPrintJobDto } from './dto/print-job.dto';

class PhotoQueryDto {
  @IsIn(['STUDENT', 'STAFF'])
  subject_type: 'STUDENT' | 'STAFF';

  @IsUUID()
  subject_id: string;

  @IsString()
  key: string;
}

type Tenant = { id: string; role: string };

/** [32.2.x] Server-built print data. The client never sends field values. */
@ApiTags('print')
@ApiTenantAuth()
@Controller('print-jobs')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.DOCUMENT_PRINT)
export class PrintJobsController {
  constructor(private readonly service: PrintJobsService) {}

  private caller(tenant: Tenant, user: JwtPayload) {
    return { tenantId: tenant.id, userId: user.sub, role: tenant.role };
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve print data for a template + subjects without creating a job.' })
  preview(
    @Body() dto: PreviewPrintJobDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.preview(this.caller(tenant, user), dto);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a print job (copy numbers + verify tokens) and return the items to render.',
  })
  create(
    @Body() dto: CreatePrintJobDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.create(this.caller(tenant, user), dto);
  }

  @Get('photo')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Stream a subject photo referenced by a preview/job item.' })
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
