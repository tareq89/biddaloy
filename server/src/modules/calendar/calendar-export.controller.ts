import { Controller, Get, Post, Body, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { CalendarExportService } from './calendar-export.service';
import { CalendarEventsService } from './calendar-events.service';
import { CalendarExportQueryDto, CloneCalendarDto } from './dto/calendar-export.dto';

/**
 * `/calendar/export` and `/calendar/clone` — [17.3.2]. Shares the
 * `/calendar` prefix with `CalendarEventsController` (Nest allows more
 * than one controller per prefix); split into its own file/service since
 * it's a distinct concern (spreadsheet export + year-to-year clone) that
 * shouldn't grow `CalendarEventsController`.
 */
@ApiTags('calendar-export')
@ApiTenantAuth()
@Controller('calendar')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class CalendarExportController {
  constructor(
    private readonly service: CalendarExportService,
    private readonly eventsService: CalendarEventsService,
  ) {}

  @Get('export')
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
    UserRole.EXECUTIVE,
  )
  @RequirePermissions(Permission.CALENDAR_READ)
  @ApiOperation({ summary: 'Export a tenant academic year calendar as .xlsx or .csv.' })
  async exportWorkbook(
    @Query() query: CalendarExportQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
    @Res() res: Response,
  ): Promise<void> {
    const format = query.format ?? 'xlsx';
    const viewer = await this.eventsService.resolveViewer(tenant.role, user.sub, tenant.id);
    const { buffer, contentType } = await this.service.exportWorkbook(
      tenant.id,
      query.academic_year_id,
      format,
      viewer,
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="calendar-export.${format}"`);
    res.send(buffer);
  }

  @Post('clone')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.CALENDAR_MANAGE)
  @ApiOperation({
    summary:
      'Clone non-HOLIDAY published events from one academic year into another as a staged ' +
      'import preview (commit via POST /calendar-import/commit).',
  })
  async clone(
    @Body() dto: CloneCalendarDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.cloneToYear(
      tenant.id,
      user.sub,
      dto.source_year_id,
      dto.target_year_id,
      dto.event_ids,
    );
  }
}
