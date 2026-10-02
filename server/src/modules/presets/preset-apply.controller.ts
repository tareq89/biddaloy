import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtPayload, Permission, UserRole } from '@biddaloy/shared';
import type { PresetApplyResult } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { PresetApplyService } from './preset-apply.service';
import { ApplyPresetDto } from './dto/apply-preset.dto';

@ApiTags('presets')
@ApiTenantAuth()
@Controller('presets')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class PresetApplyController {
  constructor(private readonly apply: PresetApplyService) {}

  @Post('apply')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.CURRICULUM_PRESET_APPLY)
  @ApiOperation({
    summary:
      'Apply a curriculum preset to a fresh school, all-or-nothing. 409 PRESET_NOT_FRESH otherwise.',
  })
  run(
    @Body() dto: ApplyPresetDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<PresetApplyResult> {
    return this.apply.apply(tenant.id, user.sub, dto, requestContext(request));
  }
}
