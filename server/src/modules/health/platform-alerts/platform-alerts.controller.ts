import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformAccessGuard } from '../../platform-identity/platform-access.guard';
import { PlatformAlertsService } from './platform-alerts.service';
import { PlatformAlertsDto } from './dto/platform-alerts.dto';

/**
 * [75.34] `GET /platform/alerts` — platform owners only (`PlatformAccessGuard`: a cockpit token;
 * any school token, SUPER_ADMIN included, gets 403). Answers from Postgres only, but the cockpit
 * session check needs Redis and fails closed (Rule 15), so the list is a 503 while Redis is down.
 */
@ApiTags('platform')
@Controller('platform/alerts')
@UseGuards(AuthGuard(['jwt', 'cockpit-jwt']), PlatformAccessGuard)
export class PlatformAlertsController {
  constructor(private readonly service: PlatformAlertsService) {}

  @Get()
  @ApiOperation({ summary: 'Open platform alerts (e.g. Redis down). Cockpit owners only.' })
  @ApiOkResponse({ type: PlatformAlertsDto })
  list(): Promise<PlatformAlertsDto> {
    return this.service.listOpen();
  }
}
