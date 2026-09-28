import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { LeaveType, Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { LeaveService } from './leave.service';
import {
  CreateLeaveRequestDto,
  DecideLeaveRequestDto,
  LeaveBalanceDto,
  LeavePolicyDto,
  LeaveRecordDto,
  QueryLeaveBalanceDto,
  UpdateLeavePolicyDto,
} from './dto/leave.dto';

/**
 * [36.3] `@Roles` is the coarse gate; `@RequirePermissions` is the actual
 * one. Requesting leave is self-service (every staff role); approving/
 * rejecting and managing quotas both require `Permission.LEAVE_APPROVE`
 * (ADMIN/EXECUTIVE only, per `shared/src/enums/permissions.ts`).
 */
@ApiTags('leave')
@ApiTenantAuth()
@Controller('leave')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class LeaveController {
  constructor(private readonly leaveService: LeaveService) {}

  @Post('requests')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.TEACHER, UserRole.EXECUTIVE)
  @ApiOperation({
    summary:
      'Request leave for a staff profile. Self-service unless the caller holds LEAVE_APPROVE ' +
      '(then any staff profile in tenant). Rejected if it would exceed the balance for the ' +
      "leave's own year.",
  })
  @ApiOkResponse({ type: LeaveRecordDto })
  async request(
    @Body() dto: CreateLeaveRequestDto,
    @CurrentTenant() tenant: { id: string; role: UserRole },
    @CurrentUser() user: { sub: string },
  ): Promise<LeaveRecordDto> {
    return this.leaveService.request(tenant.id, dto, user.sub, tenant.role);
  }

  @Post('requests/:id/decide')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @RequirePermissions(Permission.LEAVE_APPROVE)
  @ApiOperation({
    summary:
      'Approve or reject a pending leave request. Both branches re-check status under a ' +
      'transaction + row lock so concurrent decisions on the same record cannot race, and ' +
      'approve additionally re-checks the balance so concurrent approvals cannot double-spend ' +
      'the quota.',
  })
  @ApiOkResponse({ type: LeaveRecordDto })
  async decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideLeaveRequestDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { sub: string },
    @Req() req: Request,
  ): Promise<LeaveRecordDto> {
    return this.leaveService.decide(tenant.id, id, user.sub, dto, {
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Get('balance')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.TEACHER, UserRole.EXECUTIVE)
  @ApiOperation({
    summary:
      'Live-computed remaining balance per leave type for one staff member. Self-service ' +
      'unless the caller holds LEAVE_APPROVE (then any staff profile in tenant).',
  })
  @ApiOkResponse({ type: LeaveBalanceDto, isArray: true })
  async balance(
    @Query() query: QueryLeaveBalanceDto,
    @CurrentTenant() tenant: { id: string; role: UserRole },
    @CurrentUser() user: { sub: string },
  ): Promise<LeaveBalanceDto[]> {
    return this.leaveService.getBalancesForCaller(
      tenant.id,
      query.staff_profile_id,
      user.sub,
      tenant.role,
    );
  }

  @Get('policies')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.TEACHER, UserRole.EXECUTIVE)
  @ApiOperation({ summary: "This tenant's leave-type quotas." })
  @ApiOkResponse({ type: LeavePolicyDto, isArray: true })
  async policies(@CurrentTenant() tenant: { id: string }): Promise<LeavePolicyDto[]> {
    return this.leaveService.listPolicies(tenant.id);
  }

  @Put('policies/:type')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @RequirePermissions(Permission.LEAVE_APPROVE)
  @ApiOperation({ summary: "Edit one leave type's annual quota — same guard as approving." })
  @ApiOkResponse({ type: LeavePolicyDto })
  async updatePolicy(
    @Param('type', new ParseEnumPipe(LeaveType)) type: LeaveType,
    @Body() dto: UpdateLeavePolicyDto,
    @CurrentTenant() tenant: { id: string },
  ): Promise<LeavePolicyDto> {
    return this.leaveService.updatePolicy(tenant.id, type, dto.annual_quota_days);
  }
}
