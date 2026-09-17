import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  InternalServerErrorException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ApprovalGuard, ApprovalContext } from '../auth/guards/approval.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { RequireApproval } from '../auth/decorators/require-approval.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { FamilyAccessService } from '../students/family-access.service';
import { DiscountRulesService } from './discount-rules.service';
import {
  CreateDiscountRuleDto,
  UpdateDiscountRuleDto,
  toDiscountRuleDto,
} from './dto/discount-rules.dto';
import { ApprovalScope, JwtPayload, Permission, UserRole, isGuardianRole } from '@biddaloy/shared';

/**
 * [16.7.3] `DiscountRule` CRUD. Writes require `DISCOUNT_RULE_MANAGE` +
 * a fresh `X-Approval-Token` for `ApprovalScope.DISCOUNT_RULES_MANAGE`
 * (`ApprovalGuard`, consumed unconditionally — same shape as
 * `PaymentReversalService`'s route). Read is shared with family callers,
 * narrowed to their own linked students.
 *
 * [Opus review, B4 / CodeRabbit review PR #801] The write itself and its
 * `AuditService.recordApproved` proof-of-approval row are committed in one
 * transaction inside `DiscountRulesService` — this controller no longer
 * calls `recordApproved` separately (a prior version did, which meant a
 * failed audit write could leave the mutation committed with no durable
 * trail of who approved it).
 */
@ApiTags('discount-rules')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard, ApprovalGuard)
export class DiscountRulesController {
  constructor(
    private readonly discountRulesService: DiscountRulesService,
    private readonly familyAccess: FamilyAccessService,
  ) {}

  @Get('students/:id/discount-rules')
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
  )
  @RequirePermissions(Permission.FEE_READ)
  @ApiOperation({
    summary:
      "List a student's active discount rules. Staff see any student in their tenant; a " +
      'PARENT/STUDENT only their own linked student — a mismatch is refused, never silently empty.',
  })
  async listForStudent(
    @Param('id', ParseUUIDPipe) studentId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    if (isGuardianRole(tenant.role)) {
      const linkedIds = await this.familyAccess.getLinkedStudentIds(
        tenant.role,
        user.sub,
        tenant.id,
      );
      if (!linkedIds.includes(studentId)) {
        throw new ForbiddenException('Not linked to this student');
      }
    }
    const rules = await this.discountRulesService.listForStudent(tenant.id, studentId);
    return rules.map(toDiscountRuleDto);
  }

  /** Every write handler needs the same `request.approval` guarantee —
   * `ApprovalGuard` stamps it after consuming the token; `@RequireApproval`
   * makes the guard mandatory on this route, so its absence means a guard
   * misconfiguration, not a client error. */
  private requireApproval(request: Request): ApprovalContext {
    const approval = (request as unknown as { approval?: ApprovalContext }).approval;
    if (!approval) {
      throw new InternalServerErrorException(
        'ApprovalGuard did not run before a discount-rules write — @RequireApproval guard misconfigured',
      );
    }
    return approval;
  }

  @Post('discount-rules')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.DISCOUNT_RULE_MANAGE)
  @RequireApproval(ApprovalScope.DISCOUNT_RULES_MANAGE)
  @ApiOperation({
    summary:
      'Create a discount rule. Requires a fresh X-Approval-Token for "discount_rules.manage".',
  })
  async create(
    @Body() dto: CreateDiscountRuleDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const approval = this.requireApproval(request);
    const rule = await this.discountRulesService.create(
      tenant.id,
      user.sub,
      approval.approverId,
      dto,
    );
    return toDiscountRuleDto(rule);
  }

  @Patch('discount-rules/:id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.DISCOUNT_RULE_MANAGE)
  @RequireApproval(ApprovalScope.DISCOUNT_RULES_MANAGE)
  @ApiOperation({
    summary:
      'Update a discount rule. Requires a fresh X-Approval-Token for "discount_rules.manage".',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDiscountRuleDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const approval = this.requireApproval(request);
    const rule = await this.discountRulesService.update(
      tenant.id,
      id,
      user.sub,
      approval.approverId,
      dto,
    );
    return toDiscountRuleDto(rule);
  }

  @Delete('discount-rules/:id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.DISCOUNT_RULE_MANAGE)
  @RequireApproval(ApprovalScope.DISCOUNT_RULES_MANAGE)
  @ApiOperation({
    summary:
      'Delete a discount rule. Requires a fresh X-Approval-Token for "discount_rules.manage".',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<{ deleted: true }> {
    const approval = this.requireApproval(request);
    await this.discountRulesService.remove(tenant.id, id, user.sub, approval.approverId);
    return { deleted: true };
  }
}
