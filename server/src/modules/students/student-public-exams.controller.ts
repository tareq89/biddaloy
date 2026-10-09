import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtPayload, Permission } from '@biddaloy/shared';
import { requestContext } from '../../common/request-context.util';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { StudentPublicExamsService } from './student-public-exams.service';
import {
  CreateStudentPublicExamDto,
  UpdateStudentPublicExamDto,
} from './dto/student-public-exams.dto';

type Tenant = { id: string; role: string };

/** [39.2.5] D22: read = ADMIN/EXECUTIVE/TEACHER, write = ADMIN/EXECUTIVE. */
@ApiTags('students')
@ApiTenantAuth()
@Controller('students')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class StudentPublicExamsController {
  constructor(private readonly service: StudentPublicExamsService) {}

  @Get(':id/public-exams')
  @RequirePermissions(Permission.STUDENT_RECORDS_READ)
  list(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() tenant: Tenant) {
    return this.service.list(id, tenant.id);
  }

  @Post(':id/public-exams')
  @RequirePermissions(Permission.STUDENT_RECORDS_WRITE)
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateStudentPublicExamDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.create(id, dto, tenant.id, user.sub, requestContext(request));
  }

  @Patch(':id/public-exams/:examId')
  @RequirePermissions(Permission.STUDENT_RECORDS_WRITE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('examId', ParseUUIDPipe) examId: string,
    @Body() dto: UpdateStudentPublicExamDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.update(id, examId, dto, tenant.id, user.sub, requestContext(request));
  }

  @Delete(':id/public-exams/:examId')
  @RequirePermissions(Permission.STUDENT_RECORDS_WRITE)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.remove(id, examId, tenant.id, user.sub, requestContext(request));
  }
}
