import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import { requestContext } from '../../common/request-context.util';
import { setRefreshCookie } from '../auth/token-cookie';
import {
  SOCIAL_TICKET_COOKIE,
  SOCIAL_TICKET_COOKIE_PATH,
} from '../auth/social/social-ticket.service';
import { RegisterResendDto } from './dto/register-resend.dto';
import { RegisterStartDto } from './dto/register-start.dto';
import { RegisterVerifyDto } from './dto/register-verify.dto';
import {
  RegistrationService,
  RegisterStartResult,
  RegisterVerifyResult,
} from './registration.service';

/**
 * Public self-service registration [13.3.1]. Mounted under `auth/` on purpose: the social
 * ticket cookie is scoped to `/api/v1/auth`, so only routes under it receive it — the ticket id
 * never has to pass through page JavaScript.
 */
@ApiTags('registration')
@Controller('auth/register')
export class RegistrationController {
  constructor(private readonly registration: RegistrationService) {}

  @Post('start')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary: 'Stage a registration and send a code to the phone (or email outside the SMS list).',
  })
  start(@Body() dto: RegisterStartDto, @Req() request: Request): Promise<RegisterStartResult> {
    return this.registration.start(dto, requestContext(request));
  }

  @Post('resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({ summary: 'Send the code again (60 second cooldown).' })
  resend(@Body() dto: RegisterResendDto): Promise<RegisterStartResult> {
    return this.registration.resend(dto);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary: 'Prove the code: creates the school (in trial), the admin, and a signed-in session.',
  })
  async verify(
    @Body() dto: RegisterVerifyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RegisterVerifyResult> {
    const ticketId = request.cookies?.[SOCIAL_TICKET_COOKIE] as string | undefined;
    const { auth, body } = await this.registration.verify(dto, requestContext(request), ticketId);
    setRefreshCookie(response, auth.refreshToken);
    if (ticketId) response.clearCookie(SOCIAL_TICKET_COOKIE, { path: SOCIAL_TICKET_COOKIE_PATH });
    return body;
  }
}
