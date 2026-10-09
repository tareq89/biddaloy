import { Body, Controller, Get, Param, ParseEnumPipe, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EMPLOYEE_ROLES, LeaveType, Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { LeaveService } from './leave.service';
import {
  LeaveBalanceDto,
  LeavePolicyDto,
  QueryLeaveBalanceDto,
  UpdateLeavePolicyDto,
} from './dto/leave.dto';

/** Every employee role (they all have a staff profile). COMMITTEE is not an
 * employee and holds no staff-attendance permission (D17), so it stays out.
 * (EMPLOYEE_ROLES also lists SUPER_ADMIN, which RolesGuard admits anyway.) */
const LEAVE_SELF_SERVICE_ROLES = EMPLOYEE_ROLES;

/**
 * [36.3] `@Roles` is the coarse gate; `@RequirePermissions` is the actual
 * one. Reading a balance is self-service (every staff role); managing quotas requires `Permission.LEAVE_APPROVE`
 * (ADMIN/EXECUTIVE only, per `shared/src/enums/permissions.ts`).
 */
@ApiTags('leave')
@ApiTenantAuth()
@Controller('leave')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class LeaveController {
  constructor(private readonly leaveService: LeaveService) {}

  @Get('balance')
  @Roles(...LEAVE_SELF_SERVICE_ROLES)
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
  @Roles(...LEAVE_SELF_SERVICE_ROLES)
  @ApiOperation({ summary: "This tenant's leave-type quotas." })
  @ApiOkResponse({ type: LeavePolicyDto, isArray: true })
  async policies(@CurrentTenant() tenant: { id: string }): Promise<LeavePolicyDto[]> {
    return this.leaveService.listPolicies(tenant.id);
  }

  @Put('policies/:type')
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
