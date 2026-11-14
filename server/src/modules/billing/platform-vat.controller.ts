import { Body, Controller, Get, Put, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ApprovalScope, AuditAction } from '@biddaloy/shared';
import { RequireApproval } from '../auth/decorators/require-approval.decorator';
import { ApprovalGuard } from '../auth/guards/approval.guard';
import { AuditService } from '../audit/audit.service';
import { toPaisa } from '../../common/constants/money';
import type { CockpitPrincipal } from '../platform-identity/cockpit-principal';
import { PlatformAdminGuard } from '../platform-identity/platform-admin.guard';
import { UpdateVatDto, VatSettingDto } from './dto/vat.dto';
import { VatService, type VatSetting } from './vat.service';

const view = (v: VatSetting): VatSettingDto => ({
  enabled: v.rate_bp !== null,
  rate_percent: v.rate_bp === null ? null : v.rate_bp / 100,
  label: v.label,
  registration: v.registration,
});

/** [Epic 100] The platform VAT rate, label and registration. Receipts freeze their own copy at payment. */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/money/vat')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class PlatformVatController {
  constructor(
    private readonly vat: VatService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'The VAT setting.' })
  async get(@Res({ passthrough: true }) res: Response): Promise<VatSettingDto> {
    res.setHeader('Cache-Control', 'no-store');
    return view(await this.vat.get());
  }

  @Put()
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_VAT)
  @ApiOperation({ summary: 'Set or switch off VAT. Needs a step-up token.' })
  async update(
    @Body() dto: UpdateVatDto,
    @Req() req: { user: CockpitPrincipal },
  ): Promise<VatSettingDto> {
    const old = await this.vat.get();
    const next: VatSetting = {
      // toPaisa of a percent is basis points: 15.25 -> 1525.
      rate_bp: dto.enabled ? toPaisa(dto.rate_percent as number) : null,
      label: dto.label ?? old.label,
      registration:
        dto.registration === undefined ? old.registration : dto.registration?.trim() || null,
    };
    await this.vat.set(next, req.user.sub);
    await this.audit.record({
      action: AuditAction.PLATFORM_VAT_CHANGED,
      entity_type: 'PlatformAdmin',
      entity_id: req.user.sub,
      tenant_id: null,
      performed_by_user_id: req.user.sub,
      old_values: { ...old },
      new_values: { ...next },
    });
    return view(next);
  }
}
