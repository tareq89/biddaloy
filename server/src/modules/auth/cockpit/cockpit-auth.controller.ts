import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { STRICT_RATE_LIMIT } from '../../../rate-limit';
import { FailClosedWithoutRedis } from '../../../common/rate-limit/app-throttler.guard';
import { requestContext } from '../../../common/request-context.util';
import { SameOriginGuard } from '../guards/same-origin.guard';
import { CockpitAuthResult, CockpitAuthService } from './cockpit-auth.service';
import {
  COCKPIT_DEVICE_COOKIE,
  setCockpitDeviceCookie,
  setCockpitRefreshCookie,
} from './cockpit-token-cookie';
import { CockpitDeviceOtpDto } from './dto/cockpit-device-otp.dto';
import { CockpitLoginDto } from './dto/cockpit-login.dto';
import { CockpitMfaDto } from './dto/cockpit-mfa.dto';

/** Body for each step. `done` carries the access token; the refresh token is the cookie. */
function body(result: CockpitAuthResult, res: Response): Record<string, string> {
  res.setHeader('Cache-Control', 'no-store');
  switch (result.step) {
    case 'mfa':
      return { step: 'mfa', mfaToken: result.mfaToken };
    case 'enrol':
      return { step: 'enrol', enrolToken: result.enrolToken };
    case 'device':
      return { step: 'device', deviceToken: result.deviceToken };
    case 'done':
      setCockpitRefreshCookie(res, result.refreshCookieValue);
      if (result.deviceCookieValue) setCockpitDeviceCookie(res, result.deviceCookieValue);
      return { step: 'done', access_token: result.accessToken };
  }
}

/** [Epic 98] Owner sign-in: password, then authenticator, then (new device) SMS and email codes. */
@ApiTags('cockpit-auth')
@Controller('auth/cockpit')
export class CockpitAuthController {
  constructor(private readonly auth: CockpitAuthService) {}

  @Post('login')
  @FailClosedWithoutRedis()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(SameOriginGuard)
  @ApiOperation({ summary: 'Owner sign-in, step 1: password.' })
  async login(
    @Body() dto: CockpitLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return body(await this.auth.login(dto, requestContext(request)), response);
  }

  @Post('mfa')
  @FailClosedWithoutRedis()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(SameOriginGuard)
  @ApiOperation({ summary: 'Owner sign-in, step 2: authenticator or recovery code.' })
  async mfa(
    @Body() dto: CockpitMfaDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.mfaStep(
      dto,
      requestContext(request),
      request.cookies?.[COCKPIT_DEVICE_COOKIE],
    );
    return body(result, response);
  }

  @Post('device-otp')
  @FailClosedWithoutRedis()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(SameOriginGuard)
  @ApiOperation({ summary: 'Owner sign-in, step 3 (new device): SMS and email codes.' })
  async deviceOtp(
    @Body() dto: CockpitDeviceOtpDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return body(await this.auth.deviceOtp(dto, requestContext(request)), response);
  }
}
