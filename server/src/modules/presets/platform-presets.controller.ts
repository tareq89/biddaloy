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
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtPayload } from '@biddaloy/shared';
import { PlatformAccessGuard } from '../platform-identity/platform-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { requestContext } from '../../common/request-context.util';
import { PresetResetService } from './preset-reset.service';
import { ResetPresetDto, ResetPresetResponseDto } from './dto/reset-preset.dto';

/** The school comes from the path, never from @CurrentTenant (the caller's own tenant is irrelevant). */
@ApiTags('platform')
@ApiBearerAuth('bearer')
@Controller('platform/schools')
@UseGuards(AuthGuard(['jwt', 'cockpit-jwt']), PlatformAccessGuard)
export class PlatformPresetsController {
  constructor(private readonly reset: PresetResetService) {}

  @Post(':id/preset/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Undo a school's curriculum preset (Cockpit owners only). 409 PRESET_NOT_APPLIED if none is applied, 409 PRESET_RESET_BLOCKED while operational data exists. A reason is mandatory and audited.",
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
