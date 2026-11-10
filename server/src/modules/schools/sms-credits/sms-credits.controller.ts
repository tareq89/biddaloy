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
import { JwtPayload } from '@biddaloy/shared';
import { PlatformAccessGuard } from '../../platform-identity/platform-access.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { SmsCreditService } from '../../communications/credits/sms-credit.service';
import {
  QuerySmsCreditsDto,
  SmsCreditsResponseDto,
} from '../../communications/credits/dto/sms-credits.dto';
import { SmsCreditsService } from './sms-credits.service';
import { GrantSmsCreditsDto } from './dto/grant-sms-credits.dto';
import { AuthenticatedOnly } from '../../auth/decorators/authenticated-only.decorator';

/**
 * [15.6.7/#550] SUPER_ADMIN top-up/correction console for a school's SMS
 * credit balance. Mirrors `SchoolAdminsController`'s shape: platform-only,
 * `PlatformAccessGuard` (cockpit token or platform SUPER_ADMIN; a
 * tenant-local SUPER_ADMIN gets 403; no `@RequirePermissions`).
 */
@ApiTags('schools')
@ApiTenantAuth()
@Controller('platform/schools/:id/sms-credits')
@UseGuards(AuthGuard(['jwt', 'cockpit-jwt']), PlatformAccessGuard)
export class SchoolSmsCreditsController {
  constructor(
    private readonly smsCredits: SmsCreditsService,
    private readonly smsCreditService: SmsCreditService,
  ) {}

  @AuthenticatedOnly()
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

  @AuthenticatedOnly()
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
