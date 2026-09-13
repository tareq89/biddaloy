import { Controller, Get, Param, Query, UseGuards, Inject } from '@nestjs/common';
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
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { FamilyAccessService } from '../students/family-access.service';
import { WalletService } from './wallet.service';
import {
  FamilyStudentWalletResponseDto,
  StudentWalletResponseDto,
  toFamilyWalletTransaction,
} from './dto/wallet.dto';
import { Permission, UserRole, isGuardianRole } from '@biddaloy/shared';
import { JwtPayload } from '@biddaloy/shared';

/** Default page size for the wallet ledger shown on `GET /students/:id/wallet`. */
const WALLET_HISTORY_LIMIT = 50;

/**
 * The read side of a student's wallet (16.1.5). Writes only ever happen as
 * a side effect of another operation (checkout, fee generation, reversal)
 * via `WalletService.credit`/`debit`, never through a route of their own.
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
  ) {}

  @Get('students/:id/wallet')
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
}
