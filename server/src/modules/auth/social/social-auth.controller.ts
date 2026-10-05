import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { JwtPayload, SocialProvider } from '@biddaloy/shared';
import { STRICT_RATE_LIMIT } from '../../../rate-limit';
import { requestContext } from '../../../common/request-context.util';
import { CurrentUser } from '../decorators/current-user.decorator';
import { setRefreshCookie } from '../token-cookie';
import {
  SocialCallbackQueryDto,
  SocialIdentityDto,
  SocialLinkStartDto,
  SocialProvidersDto,
  SocialStartQueryDto,
} from './dto/social.dto';
import { SocialAuthService } from './social-auth.service';
import { SocialIdentityService } from './social-identity.service';

/** Binds the OAuth `state` to the browser that started the flow. */
const STATE_COOKIE = 'social_state';
const stateCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax', // the callback is a top-level GET navigation from the provider
  path: '/',
});

@ApiTags('auth')
@Controller('auth/social')
export class SocialAuthController {
  constructor(
    private readonly social: SocialAuthService,
    private readonly identities: SocialIdentityService,
  ) {}

  @Get('providers')
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({ summary: 'Names of the sign-in providers configured on this server.' })
  @ApiOkResponse({ type: SocialProvidersDto })
  providers(): SocialProvidersDto {
    return { providers: this.social.configuredProviders() };
  }

  @Get('identities')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: "The caller's connected social accounts." })
  @ApiOkResponse({ type: SocialIdentityDto, isArray: true })
  async list(@CurrentUser() user: JwtPayload): Promise<SocialIdentityDto[]> {
    const rows = await this.identities.list(user.sub);
    return rows.map(({ provider, email, created_at }) => ({ provider, email, created_at }));
  }

  @Delete('identities/:provider')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard('jwt'))
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Disconnect a social account (409 LAST_SIGN_IN_METHOD if it is the last way in).',
  })
  async unlink(
    @CurrentUser() user: JwtPayload,
    @Param('provider') provider: SocialProvider,
    @Req() request: Request,
  ): Promise<void> {
    this.social.provider(provider);
    await this.identities.unlink(user.sub, provider, requestContext(request));
  }

  @Get(':provider/start')
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({ summary: 'Redirect the browser to the provider to sign in or register.' })
  async start(
    @Param('provider') provider: string,
    @Query() query: SocialStartQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const { url, state } = await this.social.start(
      provider,
      query.intent,
      undefined,
      query.redirect,
    );
    response.cookie(STATE_COOKIE, state, { ...stateCookieOptions(), maxAge: 10 * 60_000 });
    response.redirect(HttpStatus.FOUND, url);
  }

  /**
   * Connecting needs the caller's bearer token, which a plain browser
   * navigation cannot carry, so the SPA calls this with fetch and then sends
   * the browser to the returned URL.
   */
  @Post(':provider/link-start')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt'))
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Begin connecting a social account to the signed-in user.' })
  @ApiOkResponse({ type: SocialLinkStartDto })
  async linkStart(
    @Param('provider') provider: string,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SocialLinkStartDto> {
    const { url, state } = await this.social.start(provider, 'link', user.sub);
    response.cookie(STATE_COOKIE, state, { ...stateCookieOptions(), maxAge: 10 * 60_000 });
    return { url };
  }

  @Get(':provider/callback')
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary: 'Provider redirect target; completes sign-in, registration or connect.',
  })
  async callback(
    @Param('provider') provider: string,
    @Query() query: SocialCallbackQueryDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const outcome = await this.social.callback(
      provider,
      query,
      request.cookies?.[STATE_COOKIE],
      requestContext(request),
    );
    response.clearCookie(STATE_COOKIE, stateCookieOptions());
    if (outcome.session) setRefreshCookie(response, outcome.session.refreshToken);
    response.redirect(HttpStatus.FOUND, outcome.location);
  }
}
