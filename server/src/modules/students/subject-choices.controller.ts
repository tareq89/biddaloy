import { Controller, Get, Put, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { SubjectChoicesService } from './subject-choices.service';
import { SetSubjectChoiceDto, QuerySubjectChoiceDto } from '../exams/dto/exams.dto';
import { Permission, UserRole, JwtPayload } from '@biddaloy/shared';

@ApiTags('subject-choices')
@ApiTenantAuth()
@Controller('students/:studentId/subject-choices')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class SubjectChoicesController {
  constructor(private readonly service: SubjectChoicesService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.STUDENT_UPDATE)
  @ApiOperation({ summary: "List a student's optional-subject choices for an academic year." })
  listOptions(
    @Param('studentId') studentId: string,
    @Query() query: QuerySubjectChoiceDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.listOptions(studentId, query.academic_year_id, tenant.id);
  }

  @Put()
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.STUDENT_UPDATE)
  @ApiOperation({ summary: "Set (create or update) a student's optional-subject choice." })
  setChoice(
    @Param('studentId') studentId: string,
    @Body() dto: SetSubjectChoiceDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.setChoice(studentId, dto, tenant.id, user.sub, requestContext(request));
  }
}
