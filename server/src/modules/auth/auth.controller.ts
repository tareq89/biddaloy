import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Inject,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import {
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginResponse, JwtPayload } from '@biddaloy/shared';
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
    summary:
      "Log in with email or phone + password, returning a bearer token and the caller's tenant memberships.",
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
    summary:
      "Rotate the refresh token cookie and issue a fresh access token reflecting the caller's current memberships.",
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
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
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
  async logoutAll(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const user = request.user as JwtPayload;
    await this.authService.logoutAll(user.sub, user.jti, requestContext(request));
    response.clearCookie(REFRESH_TOKEN_COOKIE, buildRefreshTokenClearCookieOptions());
  }

  /**
   * Changes the authenticated caller's own password.
   *
   * Revocation contract: on success **every refresh token for this user is
   * revoked** — no other device can renew a session, and the response carries
   * a freshly issued refresh-token family so the device that made the change
   * stays signed in. Note what this does *not* do: already-issued access
   * tokens on other devices keep working until they expire on their own (up
   * to ~15 minutes), so other sessions are cut off at their next refresh, not
   * instantly. Only the caller's own `jti` is knowable here and there is no
   * per-user "issued before" cutoff, so there is nothing to denylist the
   * others with. The caller's own access token is deliberately not denylisted
   * either — someone changing a password over a feared compromise wants the
   * attacker signed out, not themselves.
   *
   * A wrong `current_password` is a **403**, never a 401: the shared frontend
   * client silently refreshes and replays 401s, which would double-spend this
   * route's strict rate limit on a single typo. 401 here means the access
   * token is missing, invalid, or belongs to a non-active user.
   *
   * The route takes no user id from the client — it always acts on
   * `JwtPayload.sub` — so changing another user's password is impossible by
   * construction, and `forbidNonWhitelisted` turns a smuggled `user_id`
   * field into a 400.
   */
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: "Change the caller's own password.",
    description:
      'Revokes every refresh token for the caller and issues a fresh one, so the calling device ' +
      'stays signed in while no other device can renew its session. Access tokens already issued ' +
      'to other devices are NOT revoked — those sessions keep working until their token expires ' +
      '(up to ~15 minutes), then cannot refresh.',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token, or the account is not active.',
  })
  @ApiForbiddenResponse({ description: 'The supplied current_password is incorrect.' })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const user = request.user as JwtPayload;
    const result = await this.authService.changePassword(user.sub, dto, requestContext(request));

    this.setRefreshCookie(response, result.refreshToken);
    return { access_token: result.access_token, memberships: result.memberships };
  }

  private setRefreshCookie(
    response: Response,
    refreshToken: { cookieValue: string; expiresAt: Date },
  ): void {
    const maxAgeMs = refreshToken.expiresAt.getTime() - Date.now();
    // CodeQL's `SensitiveCall` heuristic (SensitiveActions.qll) marks the
    // return value of any call whose NAME matches a password-like regex, with
    // no dataflow involved — so `authService.changePassword()` is treated as
    // returning sensitive data purely because of what it is called, and every
    // field reached from it, including this one, inherits that. `login()` and
    // `refresh()` reach this same line with the same shape and are not
    // flagged, which is the tell.
    //
    // What is actually written here is a freshly issued refresh token
    // (`id.secret`, see RefreshTokenService.buildCookieValue) — never password
    // material, hashed or plain — under httpOnly + secure + sameSite=strict.
    response.cookie(
      REFRESH_TOKEN_COOKIE,
      refreshToken.cookieValue, // codeql[js/clear-text-storage-of-sensitive-data]
      buildRefreshTokenCookieOptions(maxAgeMs),
    );
  }
}
