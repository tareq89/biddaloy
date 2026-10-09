import { Body, Controller, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { STRICT_RATE_LIMIT } from '../../../rate-limit';
import { Permission, JwtPayload } from '@biddaloy/shared';
import { FineSweepService } from './fine-sweep.service';
import {
  FineSweepGenerateDto,
  FineSweepGenerateResultDto,
  FineSweepPreviewResultDto,
  FineSweepQueryDto,
} from './dto/fine-sweep.dto';

/**
 * [38.2.3] Attendance-fine sweep: `preview` is a read-only dry run,
 * `generate` writes the computed fines through `FeeGenerationService`.
 * Not wired into `fees.module.ts` yet — DI registration is 38.2.5.
 */
@ApiTags('fees')
@ApiTenantAuth()
@Controller('fees/fines')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class FineSweepController {
  constructor(@Inject(FineSweepService) private readonly fineSweepService: FineSweepService) {}

  @Post('generate/preview')
  @RequirePermissions(Permission.FEE_GENERATE)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary:
      'Read-only dry run of an attendance-fine sweep for one month: computed fine rows, ' +
      'their total, and which (student, fee structure) pairs already have a bill. Writes nothing.',
  })
  preview(
    @Body() dto: FineSweepQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<FineSweepPreviewResultDto> {
    return this.fineSweepService.preview(tenant.id, dto.month, {
      classId: dto.class_id,
      sectionId: dto.section_id,
    });
  }

  @Post('generate')
  @RequirePermissions(Permission.FEE_GENERATE)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary:
      'Generate attendance-fine bills for one month from active FineRules. Never updates an ' +
      'existing bill — REMOVE_OLDER over a paid bill and CREATE_ANYWAY both require a fresh ' +
      'X-Approval-Token for scope "fees.duplicate_override", exactly like a manual fee generation.',
  })
  generate(
    @Body() dto: FineSweepGenerateDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<FineSweepGenerateResultDto> {
    return this.fineSweepService.generate(
      tenant.id,
      user.sub,
      dto.month,
      { classId: dto.class_id, sectionId: dto.section_id },
      dto.duplicate_strategy,
      dto.notify_families,
      // `ApprovalService.consume` (via `FeeGenerationService.generate`) reads
      // `currentTenant`/`user` off the request too, not just `headers` — see
      // `fees.controller.ts`'s `generateFees` for the same cast.
      request as unknown as {
        headers: Record<string, string | string[] | undefined>;
        currentTenant?: { id: string };
        user?: { sub: string };
      },
    );
  }
}
