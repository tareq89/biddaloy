import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtPayload, type DailyLimitsView } from '@biddaloy/shared';
import { PlatformAccessGuard } from '../../platform-identity/platform-access.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { PlatformDailyLimitsService } from './platform-daily-limits.service';
import { UpdateDailyLimitsDto } from './dto/daily-limits.dto';

/**
 * [60.2.08] Cockpit owner sets daily send limits live. Platform-only: `PlatformAccessGuard`
 * (a cockpit token only; any school token, SUPER_ADMIN included, gets 403; no `@RequirePermissions`).
 * `Cache-Control: no-store` comes from the global `/api/*` middleware (Rule 14, cache-control.ts).
 */
@ApiTags('communications')
@ApiBearerAuth('bearer')
@Controller('platform')
@UseGuards(AuthGuard(['jwt', 'cockpit-jwt']), PlatformAccessGuard)
export class PlatformDailyLimitsController {
  constructor(private readonly svc: PlatformDailyLimitsService) {}

  @Get('settings/daily-limits')
  @ApiOperation({ summary: 'Platform-wide default daily send limits (stored and effective).' })
  @ApiOkResponse({ description: 'DailyLimitsView; usedToday is null.' })
  getPlatform(): Promise<DailyLimitsView> {
    return this.svc.getPlatform();
  }

  @Put('settings/daily-limits')
  @ApiOperation({ summary: 'Set the platform default; null removes a value. Audited.' })
  @ApiOkResponse({ description: 'DailyLimitsView after the change.' })
  putPlatform(@Body() dto: UpdateDailyLimitsDto, @CurrentUser() user: JwtPayload) {
    return this.svc.putPlatform(dto, user.sub);
  }

  @Get('schools/:id/daily-limits')
  @ApiOperation({
    summary: "One school's own daily send limits, effective values and today's use.",
  })
  @ApiOkResponse({ description: 'DailyLimitsView.' })
  getSchool(@Param('id', ParseUUIDPipe) id: string): Promise<DailyLimitsView> {
    return this.svc.getSchool(id);
  }

  @Put('schools/:id/daily-limits')
  @ApiOperation({ summary: "Set one school's own limits; null removes a value. Audited." })
  @ApiOkResponse({ description: 'DailyLimitsView after the change.' })
  putSchool(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDailyLimitsDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    return this.svc.putSchool(id, dto, user.sub, {
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }
}
