import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { SmsCreditService } from './sms-credit.service';
import { QuerySmsCreditsDto, SmsCreditsResponseDto } from './dto/sms-credits.dto';

/**
 * [15.6.7/#550] A tenant's own SMS credit balance + movement history.
 * Read-only — the only writer is `SmsCreditService`, reached here or via
 * the platform grant/adjust endpoint (`SchoolsSmsCreditsController`).
 * Deliberately no recipient/message data on any ledger row (see the DTO).
 */
@ApiTags('communications')
@ApiTenantAuth()
@Controller('communications/sms-credits')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class CreditsController {
  constructor(private readonly smsCredits: SmsCreditService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.COMMUNICATION_CREDIT_READ)
  @ApiOperation({
    summary:
      "This tenant's SMS credit balance and ledger, newest first. `metering: 'OFF'` still " +
      'returns the shape (an always-0/0 balance, an empty ledger) rather than a different one.',
  })
  @ApiOkResponse({ type: SmsCreditsResponseDto })
  async getSmsCredits(
    @Query() query: QuerySmsCreditsDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<SmsCreditsResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [metering, balance, { data, total }] = await Promise.all([
      this.smsCredits.isMetered(tenant.id),
      this.smsCredits.getBalance(tenant.id),
      this.smsCredits.listLedger(tenant.id, page, limit),
    ]);

    return {
      metering: metering ? 'PLATFORM' : 'OFF',
      available: balance.available,
      reserved: balance.reserved,
      ledger: {
        data: data.map((row) => ({
          id: row.id,
          kind: row.kind,
          units: row.units,
          reference_type: row.reference_type,
          reference_id: row.reference_id,
          reason: row.reason,
          created_at: row.created_at,
        })),
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }
}
