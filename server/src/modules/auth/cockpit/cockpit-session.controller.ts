import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { STRICT_RATE_LIMIT } from '../../../rate-limit';
import { FailClosedWithoutRedis } from '../../../common/rate-limit/app-throttler.guard';
import { requestContext } from '../../../common/request-context.util';
import { SameOriginGuard } from '../guards/same-origin.guard';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import type { CockpitPrincipal } from '../../platform-identity/cockpit-principal';
import { CockpitSessionService } from './cockpit-session.service';
import {
  COCKPIT_REFRESH_COOKIE,
  clearCockpitRefreshCookie,
  setCockpitRefreshCookie,
} from './cockpit-token-cookie';

/** [Epic 98] Cockpit session routes. Wired into a module by #3747. */
@ApiTags('cockpit-auth')
@Controller('auth/cockpit')
export class CockpitSessionController {
  constructor(private readonly sessions: CockpitSessionService) {}

  @Post('refresh')
  @FailClosedWithoutRedis()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(SameOriginGuard)
  @ApiOperation({ summary: 'Rotate the cockpit refresh cookie and return a new access token.' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ access_token: string }> {
    const result = await this.sessions.refresh(
      request.cookies?.[COCKPIT_REFRESH_COOKIE],
      requestContext(request),
    );
    setCockpitRefreshCookie(response, result.refreshCookieValue);
    response.setHeader('Cache-Control', 'no-store');
    return { access_token: result.accessToken };
  }

  @Post('logout')
  @FailClosedWithoutRedis()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(SameOriginGuard)
  @ApiOperation({ summary: 'End the cockpit session behind the presented cookie.' })
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.sessions.end(request.cookies?.[COCKPIT_REFRESH_COOKIE]);
    clearCockpitRefreshCookie(response);
  }

  @Post('logout-all')
  @FailClosedWithoutRedis()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard, SameOriginGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'End every cockpit session of the caller.' })
  async logoutAll(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.sessions.endAll((request.user as CockpitPrincipal).sub);
    clearCockpitRefreshCookie(response);
  }

  @Get('sessions')
  @FailClosedWithoutRedis()
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: "List the caller's live cockpit sessions." })
  async list(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const me = request.user as CockpitPrincipal;
    const rows = await this.sessions.list(me.sub);
    response.setHeader('Cache-Control', 'no-store');
    return {
      data: rows.map((s) => ({
        id: s.familyId,
        started_at: s.startedAt.toISOString(),
        last_used_at: s.lastUsedAt.toISOString(),
        user_agent: s.userAgent,
        ip_address: s.ipAddress,
        current: s.familyId === me.fam,
      })),
    };
  }

  @Delete('sessions/:id')
  @FailClosedWithoutRedis()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard, SameOriginGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: "End one of the caller's cockpit sessions." })
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const me = request.user as CockpitPrincipal;
    // Not the caller's family: 404, never 403, so a foreign id is not confirmed to exist.
    if (!(await this.sessions.endFamily(me.sub, id)))
      throw new NotFoundException('Session not found');
    if (id === me.fam) clearCockpitRefreshCookie(response);
  }
}
