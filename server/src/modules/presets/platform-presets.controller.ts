import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtPayload, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { PresetResetService } from './preset-reset.service';
import { ResetPresetDto, ResetPresetResponseDto } from './dto/reset-preset.dto';

/** The school comes from the path, never from @CurrentTenant (the caller's own tenant is irrelevant). */
@ApiTags('platform')
@ApiTenantAuth()
@Controller('platform/schools')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class PlatformPresetsController {
  constructor(private readonly reset: PresetResetService) {}

  @Post(':id/preset/reset')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary:
      "Undo a school's curriculum preset (SUPER_ADMIN only). 409 PRESET_NOT_APPLIED if none is applied, 409 PRESET_RESET_BLOCKED while operational data exists. A reason is mandatory and audited.",
  })
  @ApiOkResponse({ type: ResetPresetResponseDto })
  run(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPresetDto,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<ResetPresetResponseDto> {
    return this.reset.reset(id, user.sub, dto, requestContext(request));
  }
}
