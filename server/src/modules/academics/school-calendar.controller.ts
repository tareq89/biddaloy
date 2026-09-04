import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { SchoolCalendarService } from './school-calendar.service';
import {
  CreateHolidayDto,
  QueryHolidayDto,
  QueryWorkingDaysDto,
  UpdateHolidayDto,
} from './dto/school-calendar.dto';

/**
 * Holiday CRUD and the working-day read [9.3]'s write path and [9.4]'s
 * `AttendanceSummaryService` both depend on. Reads admit
 * ADMIN/EXECUTIVE/ACCOUNTANT/TEACHER — every staff role that already reads
 * attendance needs to see the calendar behind it. Mutations are ADMIN/
 * EXECUTIVE only, matching `academic-year.controller.ts`'s own mutation
 * gate for this academics-structure surface.
 */
@ApiTags('school-calendar')
@ApiTenantAuth()
@Controller('school-calendar')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
export class SchoolCalendarController {
  constructor(private readonly service: SchoolCalendarService) {}

  @Get('holidays')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.ACCOUNTANT, UserRole.TEACHER)
  @ApiOperation({ summary: 'List holidays for the current tenant, paginated.' })
  listHolidays(
    @Query() query: QueryHolidayDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.listHolidays(query, tenant.id);
  }

  @Post('holidays')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: 'Create a holiday (or exam-day/event calendar entry).' })
  createHoliday(
    @Body() dto: CreateHolidayDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.createHoliday(dto, tenant.id, user.sub);
  }

  @Patch('holidays/:id')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: 'Update a holiday.' })
  updateHoliday(
    @Param('id') id: string,
    @Body() dto: UpdateHolidayDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.updateHoliday(id, dto, tenant.id, user.sub);
  }

  @Delete('holidays/:id')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: 'Soft-delete a holiday.' })
  removeHoliday(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.removeHoliday(id, tenant.id, user.sub);
  }

  @Get('working-days')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.ACCOUNTANT, UserRole.TEACHER)
  @ApiOperation({
    summary:
      'Every working day in [from, to] for the current tenant — weekly-off days and holidays ' +
      'removed. Bounded to 400 days.',
  })
  getWorkingDays(
    @Query() query: QueryWorkingDaysDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.getWorkingDays({
      tenantId: tenant.id,
      from: query.from,
      to: query.to,
      academicYearId: query.academic_year_id,
    });
  }
}
