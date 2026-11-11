import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { STRICT_RATE_LIMIT } from '../../../rate-limit';
import { FailClosedWithoutRedis } from '../../../common/rate-limit/app-throttler.guard';
import { requestContext } from '../../../common/request-context.util';
import { SameOriginGuard } from '../guards/same-origin.guard';
import { CockpitPasswordService } from './cockpit-password.service';
import { CockpitForgotPasswordDto, CockpitResetPasswordDto } from './dto/cockpit-password.dto';

/** [Epic 98] Owner password recovery. Neither route signs anyone in. */
@ApiTags('cockpit-auth')
@Controller('auth/cockpit')
export class CockpitPasswordController {
  constructor(private readonly passwords: CockpitPasswordService) {}

  // No per-identifier cooldown: the app host's link flow has none either (only its OTP branch does),
  // and one here would need Redis wired into this service. STRICT_RATE_LIMIT per IP caps the sends;
  // AuthTokenService.issue revokes the previous link, so only the newest link ever works. Accepted.
  @Post('forgot-password')
  @FailClosedWithoutRedis()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(SameOriginGuard)
  @ApiOperation({ summary: 'Emails an owner a reset link. Always 202, whoever the identifier is.' })
  async forgot(@Body() dto: CockpitForgotPasswordDto): Promise<void> {
    await this.passwords.forgot(dto.identifier);
  }

  @Post('reset-password')
  @FailClosedWithoutRedis()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(SameOriginGuard)
  @ApiOperation({ summary: 'Sets a new owner password from the emailed link. Starts no session.' })
  async reset(@Body() dto: CockpitResetPasswordDto, @Req() request: Request): Promise<void> {
    await this.passwords.reset(dto, requestContext(request));
  }
}
