import { Controller, Post, Body, Req, HttpCode, HttpStatus, Inject } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LoginResponse } from '@beton-boi/shared';
import { STRICT_RATE_LIMIT } from '../../rate-limit';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: STRICT_RATE_LIMIT })
  async login(@Body() dto: LoginDto, @Req() request: Request): Promise<LoginResponse> {
    // LoginDto's HasEmailOrPhoneConstraint guarantees one of these is set.
    const identifier = (dto.email ?? dto.phone) as string;
    return this.authService.login(identifier, dto.password, {
      ip: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }
}