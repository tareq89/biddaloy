import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
  Req,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { ExamSchedulesService } from './exam-schedules.service';
import { CreateExamScheduleDto, UpdateExamScheduleDto } from './dto/exam-schedules.dto';
import { Permission, UserRole, JwtPayload, isGuardianRole } from '@biddaloy/shared';
import { FamilyAccessService } from '../students/family-access.service';
import { Student } from '../students/entities/student.entity';
import { ClassSection } from '../academics/entities/class-section.entity';

/**
 * Staff CRUD + staff read on one exam's schedule. Mirrors
 * `exams.controller.ts`'s `EXAM_MANAGE` gating (create/update/delete) and
 * adds a staff-only `GET` that shows the schedule as soon as any row
 * exists, even if incomplete (issue rule #5) — the family-facing view for
 * this same data lives on `StudentExamScheduleController` below instead of
 * here, since it needs a *student*, not an exam, as its entry point.
 */
@ApiTags('exam-schedules')
@ApiTenantAuth()
@Controller('exams/:examId/schedule')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ExamSchedulesController {
  constructor(private readonly service: ExamSchedulesService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.EXAM_MANAGE)
  @ApiOperation({ summary: "This exam's schedule rows, sorted by date then start time." })
  list(
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.listForStaff(examId, tenant.id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.EXAM_MANAGE)
  @ApiOperation({ summary: 'Schedule one subject of this exam.' })
  create(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Body() dto: CreateExamScheduleDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.create(examId, dto, tenant.id, user.sub, requestContext(request));
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.EXAM_MANAGE)
  @ApiOperation({ summary: 'Update one schedule row.' })
  update(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExamScheduleDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.update(examId, id, dto, tenant.id, user.sub, requestContext(request));
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.EXAM_MANAGE)
  @ApiOperation({ summary: 'Remove one schedule row.' })
  remove(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.remove(examId, id, tenant.id, user.sub, requestContext(request));
  }
}

/**
 * [19.11.1] A student's exam timetable across every exam for their class,
 * upcoming-first — the portal's data source. Mirrors
 * `StudentResultsController`'s shape (`students/:studentId/...`,
 * `FamilyAccessService.assertLinked` before returning data) but is keyed
 * by class rather than by exam, since one call here must cover every exam
 * the student's class sits. Guarded by `RESULT_READ` per the issue body
 * ("guarded by RESULT_READ's audience minus the published-only rule") —
 * the "published-only rule" that doesn't apply here is `Result`'s
 * publish gate; the visibility rule that *does* apply is the
 * schedule-completeness one, enforced inside the service.
 */
@ApiTags('exam-schedules')
@ApiTenantAuth()
@Controller('students/:studentId/exam-schedule')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class StudentExamScheduleController {
  constructor(
    private readonly service: ExamSchedulesService,
    private readonly familyAccess: FamilyAccessService,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.TEACHER, UserRole.PARENT, UserRole.STUDENT)
  @RequirePermissions(Permission.RESULT_READ)
  @ApiOperation({
    summary:
      "A student's exam timetable across every exam for their class, upcoming first. Staff see every exam that has any schedule row; a PARENT or STUDENT (linkage-checked) sees an exam's schedule only once it is complete.",
  })
  async listForStudent(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    await this.familyAccess.assertLinked(tenant.role, user.sub, studentId, tenant.id);

    const student = await this.studentRepo.findOne({
      where: { id: studentId, tenant_id: tenant.id, deleted_at: IsNull() },
    });
    if (!student) {
      throw new NotFoundException(`Student "${studentId}" not found`);
    }
    const section = await this.sectionRepo.findOne({
      where: { id: student.class_section_id, tenant_id: tenant.id, deleted_at: IsNull() },
    });
    if (!section) {
      throw new NotFoundException(`Class section for student "${studentId}" not found`);
    }

    return this.service.listForStudentClass(
      section.class_id,
      tenant.id,
      isGuardianRole(tenant.role),
    );
  }
}
