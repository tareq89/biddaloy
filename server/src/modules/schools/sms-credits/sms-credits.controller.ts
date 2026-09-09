import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtPayload, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { SmsCreditService } from '../../communications/credits/sms-credit.service';
import {
  QuerySmsCreditsDto,
  SmsCreditsResponseDto,
} from '../../communications/credits/dto/sms-credits.dto';
import { SmsCreditsService } from './sms-credits.service';
import { GrantSmsCreditsDto } from './dto/grant-sms-credits.dto';

/**
 * [15.6.7/#550] SUPER_ADMIN top-up/correction console for a school's SMS
 * credit balance. Mirrors `SchoolAdminsController`'s shape: platform-only,
 * `@Roles(SUPER_ADMIN)` alone (no `@RequirePermissions` — same convention
 * as every other SUPER_ADMIN-only route on `SchoolsController`, where
 * `ROLE_PERMISSIONS[SUPER_ADMIN]` already grants everything and the role
 * check is the whole gate).
 */
@ApiTags('schools')
@ApiTenantAuth()
@Controller('schools/:id/sms-credits')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.SUPER_ADMIN)
export class SchoolSmsCreditsController {
  constructor(
    private readonly smsCredits: SmsCreditsService,
    private readonly smsCreditService: SmsCreditService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      "A school's SMS credit balance and ledger, newest first, for SUPER_ADMIN's cross-school " +
      'console. Same shape as the tenant-facing GET /communications/sms-credits, but scoped to ' +
      "the :id in the path rather than the caller's own tenant.",
  })
  @ApiOkResponse({ type: SmsCreditsResponseDto })
  async getSmsCredits(
    @Param('id', ParseUUIDPipe) schoolId: string,
    @Query() query: QuerySmsCreditsDto,
  ): Promise<SmsCreditsResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const summary = await this.smsCreditService.getCreditsSummary(schoolId, page, limit);

    return {
      ...summary,
      ledger: {
        ...summary.ledger,
        data: summary.ledger.data.map((row) => ({
          id: row.id,
          kind: row.kind,
          units: row.units,
          reference_type: row.reference_type,
          reference_id: row.reference_id,
          reason: row.reason,
          created_at: row.created_at,
        })),
      },
    };
  }

  @Post()
  @ApiOperation({
    summary:
      "Grant (positive units) or adjust (negative units) a school's SMS credit balance. " +
      'Audited (School/UPDATE). Idempotent on `idempotency_key` — a repeat is a no-op, still ' +
      '200 with the current balance.',
  })
  @ApiOkResponse({ description: 'The new balance: { available, reserved }.' })
  async grantOrAdjust(
    @Param('id', ParseUUIDPipe) schoolId: string,
    @Body() dto: GrantSmsCreditsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.smsCredits.grantOrAdjust(schoolId, dto, user.sub);
  }
}
