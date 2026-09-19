import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { CalendarImportService } from './calendar-import.service';
import {
  CommitCalendarImportDto,
  CalendarImportValidateResponseDto,
} from './dto/calendar-import.dto';

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB (D12)

/**
 * `/calendar-import` — spreadsheet import for `CalendarEvent` (17.3.1):
 * template download, a dry-run `validate` that stages a row-by-row preview
 * without writing anything, and a `commit` that applies the staged preview
 * exactly once. All three routes are ADMIN/`CALENDAR_MANAGE`-only — a
 * TEACHER (or anyone without `CALENDAR_MANAGE`) is denied by
 * `PermissionsGuard` before this controller ever runs.
 */
@ApiTags('calendar-import')
@ApiTenantAuth()
@Controller('calendar-import')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class CalendarImportController {
  constructor(private readonly service: CalendarImportService) {}

  @Get('template')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.CALENDAR_MANAGE)
  @ApiOperation({ summary: 'Download the calendar import spreadsheet template.' })
  async template(@Query('format') format: string | undefined, @Res() res: Response): Promise<void> {
    const normalized = format === 'csv' ? 'csv' : 'xlsx';
    const { buffer, contentType } = await this.service.buildTemplate(normalized);
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="calendar-import-template.${normalized}"`,
    );
    res.send(buffer);
  }

  @Post('validate')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.CALENDAR_MANAGE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @ApiConsumes('multipart/form-data')
  // Without an explicit body schema the generated client types this
  // endpoint's `requestBody` as `never`, making it unusable from `ui`.
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: '.xlsx or .csv file to validate.' },
      },
    },
  })
  @ApiOperation({ summary: 'Validate an uploaded calendar spreadsheet and stage a preview.' })
  async validate(
    @UploadedFile() file: Express.Multer.File,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ): Promise<CalendarImportValidateResponseDto> {
    if (!file) {
      throw new BadRequestException('A file is required.');
    }
    return this.service.validate(tenant.id, user.sub, {
      buffer: file.buffer,
      originalname: file.originalname,
    });
  }

  @Post('commit')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.CALENDAR_MANAGE)
  @ApiOperation({ summary: 'Commit a previously staged calendar import.' })
  async commit(
    @Body() dto: CommitCalendarImportDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.commit(tenant.id, user.sub, dto.staging_id, dto.publish ?? false);
  }
}
