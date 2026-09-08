import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtPayload, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
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
  constructor(private readonly smsCredits: SmsCreditsService) {}

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
