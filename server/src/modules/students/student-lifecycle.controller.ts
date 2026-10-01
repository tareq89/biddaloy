import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { requestContext } from '../../common/request-context.util';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { UserRole, JwtPayload, Permission } from '@biddaloy/shared';
import { StudentLifecycleService } from './student-lifecycle.service';
import {
  LeaveStudentDto,
  ReadmitStudentDto,
  StudentLifecycleEventDto,
} from './dto/student-lifecycle.dto';

/**
 * [39.2.1] `@Roles` must equal the holders of the permission exactly
 * (permission-matrix.e2e-spec.ts), so a denied role gets 401 from RolesGuard.
 */
@ApiTags('students')
@ApiTenantAuth()
@Controller('students')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class StudentLifecycleController {
  constructor(
    @Inject(StudentLifecycleService) private readonly lifecycle: StudentLifecycleService,
  ) {}

  @Post(':id/leave')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @RequirePermissions(Permission.STUDENT_LIFECYCLE_MANAGE)
  @ApiOperation({ summary: 'Withdraw, transfer out or graduate a student' })
  @ApiCreatedResponse({ type: StudentLifecycleEventDto })
  leave(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LeaveStudentDto,
    @CurrentTenant() tenant: { id: string; role: UserRole },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.lifecycle.leave(id, dto, tenant.id, user.sub, requestContext(request));
  }

  @Post(':id/readmit')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @RequirePermissions(Permission.STUDENT_LIFECYCLE_MANAGE)
  @ApiOperation({ summary: 'Readmit a student who left' })
  @ApiCreatedResponse({ type: StudentLifecycleEventDto })
  readmit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReadmitStudentDto,
    @CurrentTenant() tenant: { id: string; role: UserRole },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.lifecycle.readmit(id, dto, tenant.id, user.sub, requestContext(request));
  }

  @Get(':id/lifecycle-events')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.TEACHER)
  @RequirePermissions(Permission.STUDENT_RECORDS_READ)
  @ApiOperation({ summary: "List a student's lifecycle events, newest first" })
  @ApiOkResponse({ type: [StudentLifecycleEventDto] })
  listEvents(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: UserRole },
  ) {
    return this.lifecycle.listEvents(id, tenant.id);
  }
}
