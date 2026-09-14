import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { FamilyAccessService } from '../students/family-access.service';
import { CheckoutCartService } from './checkout-cart.service';
import { CheckoutService } from './checkout.service';
import {
  CartResultDto,
  CheckoutDto,
  CheckoutResultDto,
  QueryCheckoutCartDto,
} from './dto/checkout.dto';
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
    @Inject(CheckoutService) private readonly checkoutService: CheckoutService,
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
  @ApiOkResponse({ type: CartResultDto })
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

  @Post('payments/checkout')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.PAYMENT_RECORD)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      "Record a payment across one or more students' bills — wallet credit, one-off discounts (behind the fees.discount approval), tendered cash and change, all in one idempotent, locked transaction. A repeat with an already-used idempotency_key returns 200 with the original payment instead of 201.",
  })
  @ApiCreatedResponse({ description: 'Payment recorded.', type: CheckoutResultDto })
  @ApiOkResponse({
    description: 'Idempotent replay: an already-recorded payment for this idempotency_key.',
    type: CheckoutResultDto,
  })
  async checkout(
    @Body() dto: CheckoutDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const meta = { replayed: false };
    const result = await this.checkoutService.checkout(
      dto,
      tenant.id,
      user.sub,
      request as unknown as {
        headers: Record<string, string | string[] | undefined>;
        currentTenant?: { id: string };
        user?: { sub: string };
      },
      meta,
    );
    if (meta.replayed) {
      response.status(HttpStatus.OK);
    }
    return result;
  }
}
