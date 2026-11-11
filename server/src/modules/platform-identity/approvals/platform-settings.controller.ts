import { Body, Controller, Get, Patch, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ApprovalScope } from '@biddaloy/shared';
import { ApprovalGuard } from '../../auth/guards/approval.guard';
import { RequireApproval } from '../../auth/decorators/require-approval.decorator';
import type { CockpitPrincipal } from '../cockpit-principal';
import { PlatformAdminGuard } from '../platform-admin.guard';
import {
  PlatformApprovalSettingDto,
  UpdatePlatformApprovalSettingDto,
} from './dto/platform-settings.dto';
import { APPROVALS_ENABLED_KEY, PlatformSettingsService } from './platform-settings.service';
import { TwoPersonGuard } from './two-person.guard';

/** [Epic 98] The two-person approvals switch. Turning it OFF itself needs the other owner (D8). */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/settings/approvals')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class PlatformSettingsController {
  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly twoPerson: TwoPersonGuard,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Is two-person approval on?' })
  async get(@Res({ passthrough: true }) res: Response): Promise<PlatformApprovalSettingDto> {
    res.setHeader('Cache-Control', 'no-store');
    return { enabled: (await this.settings.get(APPROVALS_ENABLED_KEY)) !== false };
  }

  // Step-up token for both directions. Only OFF also needs the other owner, so that check is a
  // call inside the handler, not a decorator (same pattern approval.guard.ts describes). A
  // refused OFF has already spent its token: the retry carries a fresh token plus
  // X-Platform-Approval.
  @Patch()
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_APPROVALS_SWITCH)
  @ApiOperation({ summary: 'Switch two-person approval on or off. Needs a step-up token.' })
  async update(
    @Body() dto: UpdatePlatformApprovalSettingDto,
    @Req() req: { user: CockpitPrincipal },
  ): Promise<PlatformApprovalSettingDto> {
    if (!dto.enabled) {
      await this.twoPerson.enforce(req, ApprovalScope.PLATFORM_APPROVALS_SWITCH, {
        action: 'Turn two-person approval off',
      });
    }
    await this.settings.set(APPROVALS_ENABLED_KEY, dto.enabled, req.user.sub);
    return { enabled: dto.enabled };
  }
}
