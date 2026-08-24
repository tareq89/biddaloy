import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { EnrollmentService } from './enrollments.service';
import { CreateEnrollmentDto, UpdateEnrollmentDto } from './dto/enrollments.dto';
import { UserRole } from '@biddaloy/shared';

@ApiTags('enrollments')
@ApiTenantAuth()
@Controller('enrollments')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
export class EnrollmentController {
  constructor(private readonly service: EnrollmentService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  create(@Body() dto: CreateEnrollmentDto, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.service.create(dto, tenant.id);
  }

  @Get('student/:studentId')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  findByStudent(
    @Param('studentId') studentId: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.findByStudent(studentId, tenant.id);
  }

  // [8.11.3] — the "move class" dialog's starting point: the student's
  // current (ACTIVE) enrollment, or null for a legacy student that
  // predates [8.11.3]'s day-one enrollment write (see EnrollmentService's
  // already-tested `findCurrentByStudent`, unrouted until now).
  @Get(':studentId/current')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  findCurrent(
    @Param('studentId') studentId: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.findCurrentByStudent(studentId, tenant.id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEnrollmentDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.update(id, dto, tenant.id);
  }
}
