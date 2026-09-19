import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { RecurringSchedulesService } from './recurring-schedules.service';
import {
  AddExclusionDto,
  CloneScheduleDto,
  CreateRecurringScheduleDto,
  QueryRecurringSchedulesDto,
  StudentScheduleItemDto,
  UpdateRecurringScheduleDto,
} from './dto/recurring-schedules.dto';
// [16.8.2] Family-facing shape from the one allow-list module.
import { FamilyStudentScheduleDto } from './dto/family.dto';
import { FamilyAccessService } from '../students/family-access.service';
import { JwtPayload, Permission, UserRole, isGuardianRole } from '@biddaloy/shared';

/**
 * [16.7.1] CRUD + exclusions + clone-to-next-year for `RecurringSchedule`,
 * plus `GET /students/:id/schedules` (a student-scoped read, kept in this
 * controller rather than `StudentController` since it's this ticket's own
 * territory). Management routes (`SCHEDULE_MANAGE`) are ADMIN/ACCOUNTANT
 * only; reads (`FEE_READ`) admit ADMIN/ACCOUNTANT/EXECUTIVE, matching
 * `FeeGenerationsController` exactly (no TEACHER — a schedule preview
 * exposes the full matched audience's names and registration numbers
 * tenant-wide, unlike a class-scoped fee list).
 */
@ApiTags('recurring-schedules')
@ApiTenantAuth()
@ApiExtraModels(StudentScheduleItemDto, FamilyStudentScheduleDto)
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@Controller()
export class RecurringSchedulesController {
  constructor(
    private readonly service: RecurringSchedulesService,
    private readonly familyAccess: FamilyAccessService,
  ) {}

  @Get('fees/schedules')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @RequirePermissions(Permission.FEE_READ)
  @ApiOperation({ summary: 'List recurring fee-generation schedules for this tenant.' })
  findAll(
    @Query() query: QueryRecurringSchedulesDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.findAll(query, tenant.id);
  }

  @Post('fees/schedules')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.SCHEDULE_MANAGE)
  @ApiOperation({ summary: 'Create a recurring fee-generation schedule.' })
  create(
    @Body() dto: CreateRecurringScheduleDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.create(dto, tenant.id, user.sub);
  }

  @Get('fees/schedules/:id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @RequirePermissions(Permission.FEE_READ)
  @ApiOperation({ summary: 'Get one recurring fee-generation schedule.' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.findOne(id, tenant.id);
  }

  @Patch('fees/schedules/:id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.SCHEDULE_MANAGE)
  @ApiOperation({ summary: 'Update a recurring fee-generation schedule.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecurringScheduleDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.update(id, dto, tenant.id, user.sub);
  }

  @Delete('fees/schedules/:id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.SCHEDULE_MANAGE)
  @ApiOperation({ summary: 'Soft-delete a recurring fee-generation schedule.' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.remove(id, tenant.id, user.sub);
  }

  @Post('fees/schedules/:id/exclusions')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.SCHEDULE_MANAGE)
  @ApiOperation({ summary: 'Exclude one student from a schedule.' })
  addExclusion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddExclusionDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.addExclusion(id, dto, tenant.id, user.sub);
  }

  @Delete('fees/schedules/:id/exclusions/:studentId')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.SCHEDULE_MANAGE)
  @ApiOperation({ summary: 'Remove a student exclusion from a schedule.' })
  removeExclusion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.removeExclusion(id, studentId, tenant.id, user.sub);
  }

  @Post('fees/schedules/:id/clone')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.SCHEDULE_MANAGE)
  @ApiOperation({
    summary:
      'Clone a schedule into another academic year. Matches fee structures by ' +
      '(name, fee_type) in the target year; structures with no match are reported ' +
      'back, not silently dropped.',
  })
  clone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloneScheduleDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.clone(id, dto, tenant.id, user.sub);
  }

  @Get('fees/schedules/:id/preview')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @RequirePermissions(Permission.FEE_READ)
  @ApiOperation({
    summary: "Preview a schedule's currently resolved audience (count + first 50).",
  })
  preview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.preview(id, tenant.id);
  }

  @Get('students/:id/schedules')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.PARENT, UserRole.STUDENT)
  @RequirePermissions(Permission.FEE_READ)
  @ApiOperation({
    summary:
      "A student's recurring schedules. Staff see the billing-automation view (ones whose " +
      'audience currently matches them, plus ones they are explicitly excluded from, ' +
      'flagged). [16.8.2] A PARENT or STUDENT must additionally be linked to this student, ' +
      'and gets an allow-listed "what will I be billed next" view instead.',
  })
  @ApiOkResponse({
    description:
      'An array of `StudentScheduleItemDto` for staff; allow-listed ' +
      '`FamilyStudentScheduleDto` rows for a PARENT/STUDENT.',
    schema: {
      type: 'array',
      items: {
        oneOf: [
          { $ref: getSchemaPath(StudentScheduleItemDto) },
          { $ref: getSchemaPath(FamilyStudentScheduleDto) },
        ],
      },
    },
  })
  async findForStudent(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    // Object-level check first: `assertLinked` no-ops for staff and throws
    // for a PARENT/STUDENT who is not linked to this child, so a family
    // caller can never read another family's billing schedule.
    await this.familyAccess.assertLinked(tenant.role, user.sub, id, tenant.id);
    if (isGuardianRole(tenant.role)) {
      return this.service.findForStudentFamily(id, tenant.id);
    }
    return this.service.findForStudent(id, tenant.id);
  }
}
