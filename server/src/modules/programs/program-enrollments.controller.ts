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
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtPayload, Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { FamilyAccessService } from '../students/family-access.service';
import { ProgramEnrollmentsService } from './program-enrollments.service';
import {
  EnrolStudentsDto,
  ListEnrollmentsQuery,
  RecordAchievementsDto,
  UpdateProgramEnrollmentDto,
} from './dto/program-enrollments.dto';

/**
 * [34.2.1] Enrol/record/achievement routes for `Program`. `PROGRAM_MANAGE`
 * gates enrolment + status changes; `PROGRAM_RECORD` (TEACHER holds this
 * without MANAGE) gates recording/un-recording achievements. Guard chain
 * and permission style cloned from `programs.controller.ts`.
 */
@ApiTags('programs')
@ApiTenantAuth()
@Controller('programs')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ProgramEnrollmentsController {
  constructor(private readonly enrollmentsService: ProgramEnrollmentsService) {}

  @Get(':id/enrollments')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.TEACHER)
  @RequirePermissions(Permission.PROGRAM_READ)
  @ApiOperation({ summary: "A program's enrolled students with achievement progress." })
  async listForProgram(
    @Param('id', ParseUUIDPipe) programId: string,
    @Query() query: ListEnrollmentsQuery,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const rows = await this.enrollmentsService.listForProgram(tenant.id, programId, query.status);
    return rows.map(({ enrollment, student, achieved_count, milestone_total }) => ({
      id: enrollment.id,
      status: enrollment.status,
      started_on: enrollment.started_on,
      ended_on: enrollment.ended_on,
      student: {
        id: student.id,
        full_name: student.full_name,
        roll_number: student.roll_number,
        class_name: student.class_section?.class?.name ?? null,
        section_name: student.class_section?.section_name ?? null,
      },
      achieved_count,
      milestone_total,
    }));
  }

  @Post(':id/enrollments')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @RequirePermissions(Permission.PROGRAM_MANAGE)
  @ApiOperation({ summary: 'Bulk-enrol up to 500 students; already-active students are skipped.' })
  async enrol(
    @Param('id', ParseUUIDPipe) programId: string,
    @Body() dto: EnrolStudentsDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.enrollmentsService.enrol(
      tenant.id,
      programId,
      user.sub,
      dto,
      requestContext(request),
    );
  }

  @Post(':id/achievements')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.TEACHER)
  @RequirePermissions(Permission.PROGRAM_RECORD)
  @ApiOperation({
    summary: "Bulk-record one milestone's achievement across up to 500 enrolments (upsert).",
  })
  async record(
    @Param('id', ParseUUIDPipe) programId: string,
    @Body() dto: RecordAchievementsDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.enrollmentsService.record(
      tenant.id,
      programId,
      user.sub,
      dto,
      requestContext(request),
    );
  }
}

@ApiTags('programs')
@ApiTenantAuth()
@Controller('program-enrollments')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ProgramEnrollmentStatusController {
  constructor(private readonly enrollmentsService: ProgramEnrollmentsService) {}

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @RequirePermissions(Permission.PROGRAM_MANAGE)
  @ApiOperation({
    summary:
      'Change an enrolment status (ACTIVE<->COMPLETED/WITHDRAWN). Never touches achievements.',
  })
  async updateStatus(
    @Param('id', ParseUUIDPipe) enrollmentId: string,
    @Body() dto: UpdateProgramEnrollmentDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const enrollment = await this.enrollmentsService.updateStatus(
      tenant.id,
      enrollmentId,
      user.sub,
      dto,
      requestContext(request),
    );
    return {
      id: enrollment.id,
      status: enrollment.status,
      started_on: enrollment.started_on,
      ended_on: enrollment.ended_on,
    };
  }
}

@ApiTags('programs')
@ApiTenantAuth()
@Controller('milestone-achievements')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class MilestoneAchievementsController {
  constructor(private readonly enrollmentsService: ProgramEnrollmentsService) {}

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.TEACHER)
  @RequirePermissions(Permission.PROGRAM_RECORD)
  @ApiOperation({ summary: 'Untick a recorded achievement.' })
  async remove(
    @Param('id', ParseUUIDPipe) achievementId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<{ deleted: true }> {
    await this.enrollmentsService.removeAchievement(
      tenant.id,
      achievementId,
      user.sub,
      requestContext(request),
    );
    return { deleted: true };
  }
}

/**
 * [D24] Portal-facing student-programs view — exact guard/decorator chain
 * as `StudentResultsController` (`exams/results.controller.ts`) so a
 * PARENT only reads their own linked child's programs.
 */
@ApiTags('programs')
@ApiTenantAuth()
@Controller('students/:studentId/programs')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class StudentProgramsController {
  constructor(
    private readonly enrollmentsService: ProgramEnrollmentsService,
    private readonly familyAccess: FamilyAccessService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.TEACHER, UserRole.PARENT, UserRole.STUDENT)
  @RequirePermissions(Permission.PROGRAM_READ)
  @ApiOperation({
    summary:
      "A student's full program picture: every enrolment with its milestones and achievements.",
  })
  async listForStudent(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    await this.familyAccess.assertLinked(tenant.role, user.sub, studentId, tenant.id);
    return this.enrollmentsService.studentPrograms(tenant.id, studentId);
  }
}
