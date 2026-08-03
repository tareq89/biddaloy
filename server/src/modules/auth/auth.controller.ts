import { Controller, Post, Body, Req, Res, HttpCode, HttpStatus, Inject, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags, ApiUnauthorizedResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LoginResponse, JwtPayload } from '@beton-boi/shared';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import {
  REFRESH_TOKEN_COOKIE,
  buildRefreshTokenCookieOptions,
  buildRefreshTokenClearCookieOptions,
} from './token-cookie';
import { SameOriginGuard } from './guards/same-origin.guard';
import { requestContext } from '../../common/request-context.util';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary: 'Log in with email or phone + password, returning a bearer token and the caller\'s tenant memberships.',
  })
  @ApiUnauthorizedResponse({
    description:
      'Invalid credentials — identical response for an unknown identifier, a wrong password, and a locked-out account (see the README\'s "Login brute-force protection" section).',
  })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    // LoginDto's HasEmailOrPhoneConstraint guarantees one of these is set.
    const identifier = (dto.email ?? dto.phone) as string;
    const result = await this.authService.login(identifier, dto.password, requestContext(request));

    this.setRefreshCookie(response, result.refreshToken);
    return { access_token: result.access_token, memberships: result.memberships };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(SameOriginGuard)
  @ApiOperation({
    summary: 'Rotate the refresh token cookie and issue a fresh access token reflecting the caller\'s current memberships.',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, invalid, or already-used refresh token.',
  })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const cookieValue = request.cookies?.[REFRESH_TOKEN_COOKIE];
    const result = await this.authService.refresh(cookieValue, requestContext(request));

    this.setRefreshCookie(response, result.refreshToken);
    return { access_token: result.access_token, memberships: result.memberships };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(SameOriginGuard)
  @ApiOperation({
    summary: 'Revoke the presented refresh token. Does not require a live access token.',
  })
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    const cookieValue = request.cookies?.[REFRESH_TOKEN_COOKIE];
    await this.authService.logout(cookieValue, requestContext(request));
    response.clearCookie(REFRESH_TOKEN_COOKIE, buildRefreshTokenClearCookieOptions());
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Revoke every refresh token for the caller and end the current session immediately.',
  })
  async logoutAll(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    const user = request.user as JwtPayload;
    await this.authService.logoutAll(user.sub, user.jti, requestContext(request));
    response.clearCookie(REFRESH_TOKEN_COOKIE, buildRefreshTokenClearCookieOptions());
  }

  private setRefreshCookie(response: Response, refreshToken: { cookieValue: string; expiresAt: Date }): void {
    const maxAgeMs = refreshToken.expiresAt.getTime() - Date.now();
    response.cookie(
      REFRESH_TOKEN_COOKIE,
      refreshToken.cookieValue,
      buildRefreshTokenCookieOptions(maxAgeMs),
    );
  }
}