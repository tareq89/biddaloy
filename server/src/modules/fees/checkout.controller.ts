import { Controller, ForbiddenException, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { FamilyAccessService } from '../students/family-access.service';
import { CheckoutCartService } from './checkout-cart.service';
import { QueryCheckoutCartDto } from './dto/checkout.dto';
import { JwtPayload, Permission, UserRole, isGuardianRole } from '@biddaloy/shared';

/**
 * `GET /payments/cart` (16.4.1) — the read side the Record Payment modal is
 * built on: every open bill for one or more students, wallet balance, and
 * an oldest-first allocation suggestion for a given amount.
 *
 * Gated on `FEE_READ`, not `PAYMENT_RECORD` — the same split
 * `payments/student/:studentId` already makes (`fees.controller.ts`):
 * `PAYMENT_RECORD` is the staff-only *write*, but a PARENT/STUDENT must be
 * able to load this same read-only view for their own child before a
 * payment is ever recorded. 16.4.2 appends the POST that actually records
 * one, gated on `PAYMENT_RECORD` as usual.
 */
@ApiTags('fees')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class CheckoutController {
  constructor(
    @Inject(CheckoutCartService) private readonly checkoutCartService: CheckoutCartService,
    @Inject(FamilyAccessService) private readonly familyAccess: FamilyAccessService,
  ) {}

  @Get('payments/cart')
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
      "Open bills, wallet balance and (with `amount`) a suggested allocation for one or more students. Staff may request any of their tenant's students; a PARENT/STUDENT must be linked to every student_id requested.",
  })
  async getCart(
    @Query() query: QueryCheckoutCartDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    if (isGuardianRole(tenant.role)) {
      const linkedIds = await this.familyAccess.getLinkedStudentIds(
        tenant.role,
        user.sub,
        tenant.id,
      );
      const linked = new Set(linkedIds);
      const hasUnlinkedStudent = query.student_ids.some((id) => !linked.has(id));
      if (hasUnlinkedStudent) {
        throw new ForbiddenException(
          "You do not have access to one or more of these students' information",
        );
      }
    }

    return this.checkoutCartService.getCart(query.student_ids, tenant.id, query.amount);
  }
}
