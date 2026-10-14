import {
  Body,
  Controller,
  Get,
  Inject,
  Logger,
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
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { UserRole, JwtPayload, Permission } from '@biddaloy/shared';
import { StudentLifecycleService } from './student-lifecycle.service';
import { FamilyAccessService } from './family-access.service';
import {
  LeaveStudentDto,
  LeaveStudentResultDto,
  ReadmitStudentDto,
  StudentLifecycleEventDto,
} from './dto/student-lifecycle.dto';

/**
 * [39.2.1] Access is gated by `@RequirePermissions` (a denied role gets 403 from PermissionsGuard).
 */
@ApiTags('students')
@ApiTenantAuth()
@Controller('students')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class StudentLifecycleController {
  private readonly logger = new Logger(StudentLifecycleController.name);

  constructor(
    @Inject(StudentLifecycleService) private readonly lifecycle: StudentLifecycleService,
    private readonly familyAccess: FamilyAccessService,
  ) {}

  @Post(':id/leave')
  @RequirePermissions(Permission.STUDENT_LIFECYCLE_MANAGE)
  @ApiOperation({ summary: 'Withdraw, transfer out or graduate a student' })
  @ApiCreatedResponse({ type: LeaveStudentResultDto })
  async leave(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LeaveStudentDto,
    @CurrentTenant() tenant: { id: string; role: UserRole },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const event = await this.lifecycle.leave(id, dto, tenant.id, user.sub, requestContext(request));
    // The leave is committed: a failed read of the bill list must not turn
    // it into a 500 (a retry would then get 409 "already left").
    const bills = await this.lifecycle
      .billsDueAfter(id, dto.occurred_on, tenant.id)
      .catch((err: unknown) => {
        this.logger.error(`billsDueAfter failed for student ${id}`, err as Error);
        return [];
      });
    return { ...event, bills_due_after_leave: bills };
  }

  @Post(':id/readmit')
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
  @RequirePermissions(Permission.STUDENT_RECORDS_READ)
  @ApiOperation({ summary: "List a student's lifecycle events, newest first" })
  @ApiOkResponse({ type: [StudentLifecycleEventDto] })
  async listEvents(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: UserRole },
    @CurrentUser() user: JwtPayload,
  ) {
    await this.familyAccess.assertLinked(tenant.role, user.sub, id, tenant.id);
    return this.lifecycle.listEvents(id, tenant.id);
  }
}
