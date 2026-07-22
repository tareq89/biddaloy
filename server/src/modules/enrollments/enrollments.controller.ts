import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { EnrollmentService } from './enrollments.service';
import { CreateEnrollmentDto, UpdateEnrollmentDto } from './dto/enrollments.dto';
import { UserRole } from '@beton-boi/shared';

@Controller('enrollments')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
export class EnrollmentController {
  constructor(private readonly service: EnrollmentService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  create(
    @Body() dto: CreateEnrollmentDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
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