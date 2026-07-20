import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LoginResponse } from '@beton-boi/shared';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<LoginResponse> {
    // Accept either email or phone as the login identifier
    const identifier = dto.email || dto.phone;
    if (!identifier) {
      throw new Error('Email or phone is required');
    }
    return this.authService.login(identifier, dto.password);
  }
}