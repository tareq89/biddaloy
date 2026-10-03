import { Body, Controller, Get, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { StaffAttendanceService } from './staff-attendance.service';
import { StaffAttendanceSummaryService } from './staff-attendance-summary.service';
import {
  PutStaffAttendanceRegisterDto,
  QueryStaffAttendanceSummaryDto,
  StaffAttendanceRegisterResponseDto,
  StaffAttendanceSummaryDto,
} from './dto/staff-attendance.dto';

/**
 * `@RequirePermissions` is the gate. Every role that holds
 * `STAFF_ATTENDANCE_MARK`/`STAFF_ATTENDANCE_READ` per
 * `shared/src/enums/permissions.ts` (ADMIN, ACCOUNTANT, TEACHER, EXECUTIVE)
 * gets in.
 */
@ApiTags('staff-attendance')
@ApiTenantAuth()
@Controller('staff-attendance')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class StaffAttendanceController {
  constructor(
    private readonly staffAttendanceService: StaffAttendanceService,
    private readonly staffAttendanceSummaryService: StaffAttendanceSummaryService,
  ) {}

  @Put('register')
  @RequirePermissions(Permission.STAFF_ATTENDANCE_MARK)
  @ApiOperation({
    summary:
      "Marks/corrects one day's staff attendance in one call. Outside the tenant's correction " +
      'window a `reason` (>=3 chars) is required, and every correction is audited.',
  })
  @ApiOkResponse({ type: StaffAttendanceRegisterResponseDto })
  async markDay(
    @Body() dto: PutStaffAttendanceRegisterDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
    @Req() req: Request,
  ) {
    return this.staffAttendanceService.markDay({
      dto,
      tenantId: tenant.id,
      role: tenant.role,
      userId: user.sub,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Get('summary')
  @RequirePermissions(Permission.STAFF_ATTENDANCE_READ)
  @ApiOperation({ summary: "One staff member's attendance counts/percentage over a date range." })
  @ApiOkResponse({ type: StaffAttendanceSummaryDto })
  async getSummary(
    @Query() query: QueryStaffAttendanceSummaryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.staffAttendanceSummaryService.getSummary({
      tenantId: tenant.id,
      staffProfileId: query.staff_profile_id,
      from: query.from,
      to: query.to,
      role: tenant.role,
      userId: user.sub,
    });
  }
}
