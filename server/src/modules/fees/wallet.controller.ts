import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { Request } from 'express';
import { DataSource } from 'typeorm';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { FamilyAccessService } from '../students/family-access.service';
import { WalletService } from './wallet.service';
import { StudentWalletResponseDto, WalletPayoutDto } from './dto/wallet.dto';
import { ApprovalService } from '../auth/guards/approval.guard';
// [16.8.2] Family-facing shapes live in the one allow-list module.
import { FamilyStudentWalletResponseDto, toFamilyWalletTransaction } from './dto/family.dto';
import { ApprovalScope, Permission, isGuardianRole } from '@biddaloy/shared';
import { JwtPayload } from '@biddaloy/shared';

/** Default page size for the wallet ledger shown on `GET /students/:id/wallet`. */
const WALLET_HISTORY_LIMIT = 50;

/**
 * A student's wallet (16.1.5): the read route, plus the staff-only payout
 * (MON-09). Other writes only happen as a side effect of another operation
 * (checkout, fee generation, reversal) via `WalletService.credit`/`debit`.
 */
@ApiTags('fees')
@ApiTenantAuth()
@ApiExtraModels(StudentWalletResponseDto, FamilyStudentWalletResponseDto)
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class WalletController {
  constructor(
    @Inject(WalletService) private readonly walletService: WalletService,
    @Inject(FamilyAccessService) private readonly familyAccess: FamilyAccessService,
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(ApprovalService) private readonly approvalService: ApprovalService,
  ) {}

  @Get('students/:id/wallet')
  @RequirePermissions(Permission.FEE_READ)
  @ApiOperation({
    summary:
      "A student's wallet balance and transaction history. A PARENT or STUDENT must additionally be linked to this student, and gets a reduced transaction shape without staff-only fields.",
  })
  @ApiOkResponse({
    description:
      'The full `StudentWalletResponseDto` for staff; a `FamilyStudentWalletResponseDto` (allow-listed transaction fields only) for a PARENT/STUDENT.',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(StudentWalletResponseDto) },
        { $ref: getSchemaPath(FamilyStudentWalletResponseDto) },
      ],
    },
  })
  async getWallet(
    @Param('id') studentId: string,
    @Query('page') page: string | undefined,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ): Promise<StudentWalletResponseDto | FamilyStudentWalletResponseDto> {
    await this.familyAccess.assertLinked(tenant.role, user.sub, studentId, tenant.id);

    const parsedPage = page ? Number(page) : 1;
    const pageNum = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const [balance, history] = await Promise.all([
      this.walletService.balance(studentId, tenant.id),
      this.walletService.history(studentId, tenant.id, pageNum, WALLET_HISTORY_LIMIT),
    ]);

    if (isGuardianRole(tenant.role)) {
      return {
        balance,
        transactions: history.data.map(toFamilyWalletTransaction),
      };
    }
    return {
      balance,
      // tx.amount is a numeric-as-string from the pg driver; normalize so
      // the staff shape matches `balance`'s type and the OpenAPI contract.
      transactions: history.data.map((tx) => ({ ...tx, amount: Number(tx.amount) })),
    };
  }

  @Post('students/:id/wallet/payout')
  @RequirePermissions(Permission.PAYMENT_REVERSE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Pay wallet money out to the family as a cash refund (MON-09). Staff only; needs a fresh payments.reverse approval token (X-Approval-Token); the service consumes it after every check passes. Works for a student who has left. 409 WALLET_PAYOUT_EXCEEDS_BALANCE if more than the balance.',
  })
  @ApiOkResponse({ type: StudentWalletResponseDto })
  async payout(
    @Param('id', ParseUUIDPipe) studentId: string,
    @Body() dto: WalletPayoutDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<StudentWalletResponseDto> {
    await this.dataSource.transaction((manager) =>
      this.walletService.payout(
        {
          studentId,
          tenantId: tenant.id,
          amount: dto.amount,
          reason: dto.reason,
          actorUserId: user.sub,
          approve: async () =>
            (
              await this.approvalService.consume(
                request as unknown as Parameters<ApprovalService['consume']>[0],
                ApprovalScope.PAYMENTS_REVERSE,
              )
            ).approverId,
        },
        manager,
      ),
    );
    const [balance, history] = await Promise.all([
      this.walletService.balance(studentId, tenant.id),
      this.walletService.history(studentId, tenant.id, 1, WALLET_HISTORY_LIMIT),
    ]);
    return {
      balance,
      transactions: history.data.map((tx) => ({ ...tx, amount: Number(tx.amount) })),
    };
  }
}
