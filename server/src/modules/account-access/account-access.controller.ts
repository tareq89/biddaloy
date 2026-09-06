import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { LoginResponse } from '@biddaloy/shared';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import { requestContext } from '../../common/request-context.util';
import { setRefreshCookie } from '../auth/token-cookie';
import { toLatinDigits } from '../../common/utils/bengali-digits.util';
import { LoginResponseDto } from '../auth/dto/auth-response.dto';
import { ActivationService, ActivateVerifyResult } from './activation.service';
import { RecoveryService, ForgotPasswordResult } from './recovery.service';
import { OtpLoginService, OtpLoginRequestResult } from './otp-login.service';
import { ActivateVerifyDto } from './dto/activate-verify.dto';
import { ActivateDto } from './dto/activate.dto';
import { ActivateResendDto } from './dto/activate-resend.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { OtpRequestDto } from './dto/otp-request.dto';
import { OtpVerifyDto } from './dto/otp-verify.dto';

/**
 * 12.2's public activation surface, plus 12.3's public recovery surface.
 * Every route here is public (no guard) and throttled — an invitee/locked-
 * out user has no valid session yet by definition, and a token/OTP guess is
 * exactly the brute-force shape `STRICT_RATE_LIMIT` exists for.
 */
@ApiTags('auth')
@Controller('auth')
export class AccountAccessController {
  constructor(
    private readonly activation: ActivationService,
    private readonly recovery: RecoveryService,
    private readonly otpLogin: OtpLoginService,
  ) {}

  @Post('activate/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary: 'Checks an invite token and, if live, returns who it belongs to — never email/phone.',
  })
  async verify(@Body() dto: ActivateVerifyDto): Promise<ActivateVerifyResult> {
    return this.activation.verify(dto.token);
  }

  @Post('activate')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary: 'Consumes an invite token, sets a password, and signs the caller in.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  async activate(
    @Body() dto: ActivateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const result = await this.activation.activate(dto.token, dto.password, requestContext(request));
    setRefreshCookie(response, result.refreshToken);
    return { access_token: result.access_token, memberships: result.memberships };
  }

  @Post('activate/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary: 'Self-service resend of an invite link, by identifier. Always 202 — enumeration-safe.',
  })
  async resend(@Body() dto: ActivateResendDto): Promise<void> {
    await this.activation.resend(dto.identifier);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary:
      'Requests a password reset OTP (phone) or link (email) by identifier. Always 202 — enumeration-safe.',
  })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() request: Request,
  ): Promise<ForgotPasswordResult> {
    return this.recovery.forgot(dto.identifier, requestContext(request));
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary:
      'Sets a new password via an OTP ({ phone, otp }) or a reset link ({ token }), and signs the caller in.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const result = await this.recovery.reset(dto, requestContext(request));
    setRefreshCookie(response, result.refreshToken);
    return { access_token: result.access_token, memberships: result.memberships };
  }

  @Post('otp/request')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary: 'Requests a passwordless-login OTP by phone. Always 202 — enumeration-safe.',
  })
  async otpRequest(
    @Body() dto: OtpRequestDto,
    @Req() request: Request,
  ): Promise<OtpLoginRequestResult> {
    const phone = toLatinDigits(dto.phone);
    return this.otpLogin.request(phone, requestContext(request));
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary: 'Verifies a passwordless-login OTP and signs the caller in.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  async otpVerify(
    @Body() dto: OtpVerifyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const phone = toLatinDigits(dto.phone);
    const otp = toLatinDigits(dto.otp);
    const result = await this.otpLogin.verify(phone, otp, requestContext(request));
    setRefreshCookie(response, result.refreshToken);
    return { access_token: result.access_token, memberships: result.memberships };
  }
}
