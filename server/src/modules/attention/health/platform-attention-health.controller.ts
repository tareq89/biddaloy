import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformAccessGuard } from '../../platform-identity/platform-access.guard';
import { AttentionHealthService } from './attention-health.service';
import { PlatformAttentionHealthDto } from './dto/platform-attention-health.dto';

/**
 * [67.1.09] `GET /platform/attention/health` — platform owners only (`PlatformAccessGuard`:
 * a cockpit token, no tenant header; any school token gets 403). Same guard as
 * `PlatformBackupHealthController`. Global engine data only — no tenant rows.
 */
@ApiTags('platform')
@Controller('platform/attention')
@UseGuards(AuthGuard(['jwt', 'cockpit-jwt']), PlatformAccessGuard)
export class PlatformAttentionHealthController {
  constructor(private readonly service: AttentionHealthService) {}

  @Get('health')
  @ApiOperation({
    summary: 'Attention engine last sweeps, durations and failing rules. Cockpit owners only.',
  })
  @ApiOkResponse({ type: PlatformAttentionHealthDto })
  health(): Promise<PlatformAttentionHealthDto> {
    return this.service.getHealth();
  }
}
