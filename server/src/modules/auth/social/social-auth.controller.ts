import {
  Body,
  Controller,
  Delete,
  NotFoundException,
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
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { JwtPayload, SocialProvider } from '@biddaloy/shared';
import { STRICT_RATE_LIMIT } from '../../../rate-limit';
import { requestContext } from '../../../common/request-context.util';
import { CurrentUser } from '../decorators/current-user.decorator';
import { setRefreshCookie } from '../token-cookie';
import {
  FacebookDataDeletionDto,
  FacebookDataDeletionResponseDto,
  SocialCallbackQueryDto,
  SocialIdentityDto,
  SocialLinkStartDto,
  SocialProvidersDto,
  SocialStartQueryDto,
} from './dto/social.dto';
import { SocialAuthService } from './social-auth.service';
import { SocialIdentityService } from './social-identity.service';
import {
  SOCIAL_TICKET_COOKIE,
  SOCIAL_TICKET_COOKIE_MAX_AGE_MS,
  SOCIAL_TICKET_COOKIE_PATH,
} from './social-ticket.service';

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
    // Validate against the enum, not the configured list: users must be able
    // to disconnect after the provider's env values are removed.
    if (!Object.values(SocialProvider).includes(provider)) {
      throw new NotFoundException('Unknown sign-in provider');
    }
    await this.identities.unlink(user.sub, provider, requestContext(request));
  }

  /** Meta calls this (form-encoded) when someone removes the app; the signature is the auth. */
  @Post('facebook/data-deletion')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({ summary: "Meta's data-deletion callback: removes the Facebook identity only." })
  @ApiOkResponse({ type: FacebookDataDeletionResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad signed_request.' })
  facebookDataDeletion(
    @Body() body: FacebookDataDeletionDto,
    @Req() request: Request,
  ): Promise<FacebookDataDeletionResponseDto> {
    return this.social.facebookDataDeletion(body.signed_request, requestContext(request));
  }

  @Get(':provider/start')
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({ summary: 'Redirect the browser to the provider to sign in or register.' })
  @ApiResponse({ status: HttpStatus.FOUND, description: 'Redirect to the provider.' })
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
  @ApiResponse({ status: HttpStatus.FOUND, description: 'Redirect back into the app.' })
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
    if (outcome.ticket) {
      response.cookie(SOCIAL_TICKET_COOKIE, outcome.ticket, {
        ...stateCookieOptions(),
        path: SOCIAL_TICKET_COOKIE_PATH,
        maxAge: SOCIAL_TICKET_COOKIE_MAX_AGE_MS,
      });
    }
    response.redirect(HttpStatus.FOUND, outcome.location);
  }
}
