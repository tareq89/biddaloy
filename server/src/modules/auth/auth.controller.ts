import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  ParseUUIDPipe,
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
  ApiOkResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginResponse, JwtPayload } from '@biddaloy/shared';
import { LoginResponseDto } from './dto/auth-response.dto';
import { SessionListDto } from './dto/session.dto';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import {
  REFRESH_TOKEN_COOKIE,
  buildRefreshTokenClearCookieOptions,
  setRefreshCookie,
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
  @ApiOkResponse({ type: LoginResponseDto })
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

    setRefreshCookie(response, result.refreshToken);
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
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, invalid, or already-used refresh token.',
  })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const cookieValue = request.cookies?.[REFRESH_TOKEN_COOKIE];
    const result = await this.authService.refresh(cookieValue, requestContext(request));

    setRefreshCookie(response, result.refreshToken);
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
   * Lists the caller's live refresh-token families ("sessions" / devices).
   * Identified entirely by `JwtPayload.sub` — no `X-Tenant-ID`, no
   * `@RequirePermissions()`, since a session spans every tenant the user
   * belongs to and is never another user's data. `current` is `true` for
   * the family behind whatever refresh cookie was presented, `false` on
   * every row for a bare API client with no cookie.
   */
  @Get('sessions')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: "List the caller's active sessions (refresh-token families)." })
  @ApiOkResponse({ type: SessionListDto })
  async listSessions(@Req() request: Request): Promise<SessionListDto> {
    const user = request.user as JwtPayload;
    const cookieValue = request.cookies?.[REFRESH_TOKEN_COOKIE];
    const data = await this.authService.listSessions(user.sub, cookieValue);
    return { data };
  }

  /**
   * Revokes one refresh-token family belonging to the caller.
   *
   * Revocation contract: revoking a non-current family cuts that device off
   * at its next refresh (up to ~15 minutes of access-token life remains on
   * it); revoking the *current* family (the one behind this request's own
   * refresh cookie) denylists this access token immediately and clears the
   * cookie, ending this device's session right away.
   *
   * `SameOriginGuard` is applied because this is a state-changing route
   * that consults the cookie — it deliberately allows a request with no
   * `Origin` header (non-browser clients) through, so it is defense-in-depth
   * behind `SameSite=Strict` on the cookie, not the primary control.
   *
   * A family that doesn't belong to the caller is a 404, never a 403 — a
   * 403 would confirm to the caller that some other user's family id
   * exists. An already-revoked family is an idempotent 204, not a 404.
   */
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(AuthGuard('jwt'), SameOriginGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: "Revoke one of the caller's sessions (refresh-token families)." })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: "No such family for the caller's account." })
  async revokeSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const user = request.user as JwtPayload;
    const cookieValue = request.cookies?.[REFRESH_TOKEN_COOKIE];
    const tenantId = (request.headers['x-tenant-id'] as string | undefined) ?? null;
    const revokedCurrent = await this.authService.revokeSession(
      user.sub,
      id,
      cookieValue,
      user.jti,
      requestContext(request),
      tenantId,
    );
    if (revokedCurrent) {
      response.clearCookie(REFRESH_TOKEN_COOKIE, buildRefreshTokenClearCookieOptions());
    }
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
  @ApiOkResponse({ type: LoginResponseDto })
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

    setRefreshCookie(response, result.refreshToken);
    return { access_token: result.access_token, memberships: result.memberships };
  }
}
