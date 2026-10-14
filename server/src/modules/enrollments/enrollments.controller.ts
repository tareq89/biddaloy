import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Res,
  UseGuards,
  Req,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { teacherCanSeeStudent } from '../classes/teacher-scope.service';
import type { Response, Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { ApiExtraModels, ApiOkResponse, ApiTags, getSchemaPath } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { EnrollmentService } from './enrollments.service';
import { CreateEnrollmentDto, UpdateEnrollmentDto } from './dto/enrollments.dto';
import { Enrollment } from '../students/entities/enrollment.entity';
import { Permission, UserRole, JwtPayload, RoleScope, roleScope } from '@biddaloy/shared';

@ApiTags('enrollments')
@ApiTenantAuth()
@ApiExtraModels(Enrollment)
@Controller('enrollments')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class EnrollmentController {
  constructor(
    private readonly service: EnrollmentService,
    private readonly dataSource: DataSource,
  ) {}

  /** Epic 75 D2/D13: a TEACHER reads only students in their current-year sections; a miss is 404. */
  private async assertTeacherCanSee(
    tenant: { id: string; role: string },
    userId: string,
    studentId: string,
  ) {
    const scope = roleScope(tenant.role);
    if (scope === RoleScope.TENANT) return;
    if (
      scope !== RoleScope.ASSIGNED_SECTIONS ||
      !(await teacherCanSeeStudent(this.dataSource.manager, {
        userId,
        tenantId: tenant.id,
        studentId,
      }))
    ) {
      throw new NotFoundException('Student not found');
    }
  }

  @Post()
  // [10.4] G3 grants AC STUDENT_UPDATE (front-office intake); G1 tightens E
  // off (no STUDENT_UPDATE, no write surface).
  @RequirePermissions(Permission.STUDENT_UPDATE)
  create(
    @Body() dto: CreateEnrollmentDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.create(dto, tenant.id, user.sub, requestContext(request), tenant.role);
  }

  @Get('student/:studentId')
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.OFFICE_STAFF,
    UserRole.EXAM_CONTROLLER,
  )
  @RequirePermissions(Permission.STUDENT_READ)
  async findByStudent(
    @Param('studentId') studentId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertTeacherCanSee(tenant, user.sub, studentId);
    return this.service.findByStudent(studentId, tenant.id);
  }

  // [8.11.3] — the "move class" dialog's starting point: the student's
  // current (ACTIVE) enrollment, or null for a legacy student that
  // predates [8.11.3]'s day-one enrollment write (see EnrollmentService's
  // already-tested `findCurrentByStudent`, unrouted until now).
  //
  // `@Res({ passthrough: false })`: Nest's default response handling
  // treats a `null` return value the same as `undefined` (platform-express's
  // `isNil` check) and sends an empty body instead of the JSON literal
  // `null` — indistinguishable from a network hiccup to a caller expecting
  // `Enrollment | null`. Replying explicitly keeps the wire response
  // matching that documented type.
  @Get(':studentId/current')
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.OFFICE_STAFF,
    UserRole.EXAM_CONTROLLER,
  )
  @RequirePermissions(Permission.STUDENT_READ)
  @ApiOkResponse({
    description:
      "The student's current ACTIVE enrollment, or null for a legacy student with none yet.",
    schema: { allOf: [{ $ref: getSchemaPath(Enrollment) }], nullable: true },
  })
  async findCurrent(
    @Param('studentId') studentId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    await this.assertTeacherCanSee(tenant, user.sub, studentId);
    const enrollment = await this.service.findCurrentByStudent(studentId, tenant.id);
    res.status(200).json(enrollment);
  }

  @Patch(':id')
  // [10.4] G3, G1 — same reasoning as create() above.
  @RequirePermissions(Permission.STUDENT_UPDATE)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEnrollmentDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.update(
      id,
      dto,
      tenant.id,
      user.sub,
      requestContext(request),
      undefined,
      tenant.role,
    );
  }
}
