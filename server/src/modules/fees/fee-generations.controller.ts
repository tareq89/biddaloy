import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { FeeGenerationsService } from './fee-generations.service';
import { FeeGenerationBatchService } from './fee-generation-batch.service';
import {
  PatchFeeGenerationDto,
  QueryFeeGenerationBillsDto,
  QueryFeeGenerationsDto,
  RemoveUncollectedResultDto,
} from './dto/fee-generations.dto';
import { JwtPayload, Permission, UserRole } from '@biddaloy/shared';

/**
 * [16.1.4] Read-only log of fee-generation batches (`fee_generations`) — the
 * data behind the "Generation log" page. Writing a batch happens as a side
 * effect of generating fees (16.3.1) or a scheduled run (16.7.2), through
 * `FeeGenerationsService.create`, not through this controller.
 */
@ApiTags('fee-generations')
@ApiTenantAuth()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@Controller('fees/generations')
export class FeeGenerationsController {
  constructor(
    private readonly service: FeeGenerationsService,
    private readonly batchService: FeeGenerationBatchService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @RequirePermissions(Permission.FEE_READ)
  @ApiOperation({
    summary:
      'Page of fee-generation batches, newest first, with billed/collected totals and collection status.',
  })
  findAll(
    @Query() query: QueryFeeGenerationsDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.findAll(query, tenant.id);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @RequirePermissions(Permission.FEE_READ)
  @ApiOperation({ summary: 'One fee-generation batch.' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.findOne(id, tenant.id);
  }

  @Get(':id/bills')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @RequirePermissions(Permission.FEE_READ)
  @ApiOperation({ summary: 'Paged bills this batch created, with student/fee detail.' })
  findBills(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryFeeGenerationBillsDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.findBills(id, query, tenant.id);
  }

  // --- [16.3.2] Batch mutations: fix a batch that was generated wrong ---
  //
  // Free while nothing is collected; a bill in scope with money against it
  // (paid_amount > 0 or a payment allocation) needs a fresh
  // X-Approval-Token for scope "fees.edit_paid" — see
  // `FeeGenerationBatchService`'s own doc comment for why this is an
  // imperative `ApprovalService.consume` call inside the service rather
  // than a `@RequireApproval` decorator here.

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.FEE_GENERATE)
  @ApiOperation({
    summary:
      "Change a batch's period_start/period_type/due_date and re-stamp every one of its " +
      'bills to match. 409 (with the colliding students) if the new period_start collides ' +
      'with an existing bill. Needs a fresh X-Approval-Token for scope "fees.edit_paid" when ' +
      'any bill in scope already has money against it.',
  })
  patch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchFeeGenerationDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<void> {
    return this.batchService.patch(
      id,
      dto,
      tenant.id,
      user.sub,
      request as unknown as {
        headers: Record<string, string | string[] | undefined>;
        currentTenant?: { id: string };
        user?: { sub: string };
      },
    );
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.FEE_GENERATE)
  @ApiOperation({
    summary:
      'Soft-delete the whole batch and all its bills. Needs a fresh X-Approval-Token for ' +
      'scope "fees.edit_paid" when any bill has money against it; any wallet auto-apply on a ' +
      'removed bill is reversed back to the wallet.',
  })
  deleteBatch(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<void> {
    return this.batchService.deleteBatch(
      id,
      tenant.id,
      user.sub,
      request as unknown as {
        headers: Record<string, string | string[] | undefined>;
        currentTenant?: { id: string };
        user?: { sub: string };
      },
    );
  }

  @Delete(':id/students/:studentId')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.FEE_GENERATE)
  @ApiOperation({
    summary:
      "Soft-delete just this student's bills from the batch. Same approval/wallet-reversal " +
      'rules as deleting the whole batch.',
  })
  removeStudent(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<void> {
    return this.batchService.removeStudent(
      id,
      studentId,
      tenant.id,
      user.sub,
      request as unknown as {
        headers: Record<string, string | string[] | undefined>;
        currentTenant?: { id: string };
        user?: { sub: string };
      },
    );
  }

  @Post(':id/remove-uncollected')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.FEE_GENERATE)
  @ApiOperation({
    summary:
      'Soft-delete only the bills in this batch with no money against them (paid_amount = 0, ' +
      'no allocation). No approval needed. Returns how many were removed.',
  })
  removeUncollected(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ): Promise<RemoveUncollectedResultDto> {
    return this.batchService.removeUncollected(id, tenant.id, user.sub);
  }
}
