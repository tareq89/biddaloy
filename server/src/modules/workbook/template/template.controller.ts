import { Controller, Get, Header, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Permission, UserRole } from '@biddaloy/shared';
import { STRICT_RATE_LIMIT } from '../../../rate-limit';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { GetTemplateDto } from './dto/template.dto';
import { TemplateService } from './template.service';
import { XLSX_MIME } from './template.constants';

/**
 * [14.13.1] `GET /backup/template` — a blank workbook with samples,
 * dropdowns and a README sheet, so a school can move into Biddaloy from
 * paper or another system. A dedicated controller, not bolted onto
 * `WorkbookController`'s `@Controller('backup')`: same base path, same
 * `BACKUP_MANAGE` permission (epic D12), but nothing else in common with
 * the export/job-history surface.
 */
@ApiTags('backup')
@ApiTenantAuth()
@Controller('backup')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@RequirePermissions(Permission.BACKUP_MANAGE)
export class TemplateController {
  constructor(private readonly templates: TemplateService) {}

  @Get('template')
  @Throttle({ default: STRICT_RATE_LIMIT })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'A blank workbook with header rows, one SAMPLE row per sheet, enum/bool dropdowns and a ' +
      '_readme sheet. `lang` defaults to the tenant locale.',
  })
  async get(
    @Query() query: GetTemplateDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const lang = query.lang ?? (await this.templates.defaultLang(tenant.id));
    const buffer = await this.templates.build(tenant.id, lang);

    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="biddaloy-template-${lang}.xlsx"`);
    res.setHeader('Content-Length', buffer.byteLength);
    return new StreamableFile(buffer);
  }
}
