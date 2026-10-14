import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PlatformSuperAdminGuard } from '../../auth/guards/platform-super-admin.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AttentionHealthService } from './attention-health.service';
import { PlatformAttentionHealthDto } from './dto/platform-attention-health.dto';
import { AuthenticatedOnly } from '../../auth/decorators/authenticated-only.decorator';

/**
 * [67.1.09] `GET /platform/attention/health` — platform SUPER_ADMIN only
 * (`PlatformSuperAdminGuard`, 75.34 review r1: a school-local SUPER_ADMIN gets 403). Same guard
 * chain as `PlatformBackupHealthController`: `ContextGuard` needs the
 * caller's own `X-Tenant-ID` (no bearing on the result; no header = 401).
 * Global engine data only — no tenant rows.
 */
@ApiTags('platform')
@Controller('platform/attention')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard, PlatformSuperAdminGuard)
@Roles(UserRole.SUPER_ADMIN)
export class PlatformAttentionHealthController {
  constructor(private readonly service: AttentionHealthService) {}

  @AuthenticatedOnly()
  @Get('health')
  @ApiOperation({
    summary: 'Attention engine last sweeps, durations and failing rules. SUPER_ADMIN only.',
  })
  @ApiOkResponse({ type: PlatformAttentionHealthDto })
  health(): Promise<PlatformAttentionHealthDto> {
    return this.service.getHealth();
  }
}
