import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import type { CockpitEnrolConfirmResponse, CockpitEnrolStartResponse } from '@biddaloy/shared';
import { STRICT_RATE_LIMIT } from '../../../rate-limit';
import { FailClosedWithoutRedis } from '../../../common/rate-limit/app-throttler.guard';
import { requestContext } from '../../../common/request-context.util';
import { SameOriginGuard } from '../guards/same-origin.guard';
import { CockpitEnrolService } from './cockpit-enrol.service';
import { setCockpitDeviceCookie, setCockpitRefreshCookie } from './cockpit-token-cookie';
import { CockpitEnrolConfirmDto, CockpitEnrolStartDto } from './dto/cockpit-enrol.dto';

/** [Epic 98] Authenticator enrolment, reached only with an `enrol` step token. */
@ApiTags('cockpit-auth')
@Controller('auth/cockpit')
export class CockpitEnrolController {
  constructor(private readonly enrol: CockpitEnrolService) {}

  @Post('enrol/start')
  @FailClosedWithoutRedis()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(SameOriginGuard)
  @ApiOperation({
    summary: 'Enrolment step 1: SMS and email codes, returns the authenticator secret.',
  })
  async start(
    @Body() dto: CockpitEnrolStartDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CockpitEnrolStartResponse> {
    response.setHeader('Cache-Control', 'no-store');
    return this.enrol.start(dto);
  }

  @Post('enrol/confirm')
  @FailClosedWithoutRedis()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(SameOriginGuard)
  @ApiOperation({
    summary: 'Enrolment step 2: first authenticator code; returns the recovery codes once.',
  })
  async confirm(
    @Body() dto: CockpitEnrolConfirmDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CockpitEnrolConfirmResponse & { step: 'done'; access_token: string }> {
    const { recoveryCodes, session } = await this.enrol.confirm(dto, requestContext(request));
    setCockpitRefreshCookie(response, session.refreshCookieValue);
    if (session.deviceCookieValue) setCockpitDeviceCookie(response, session.deviceCookieValue);
    response.setHeader('Cache-Control', 'no-store');
    return { step: 'done', access_token: session.accessToken, recoveryCodes };
  }
}
