import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtPayload } from '@biddaloy/shared';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import { requestContext } from '../../common/request-context.util';
import { FirstPasswordService } from './first-password.service';
import { FirstPasswordDto } from './dto/first-password.dto';

/** Signed-in, no tenant header needed — acts only on the caller's own account. */
@ApiTags('auth')
@Controller('account')
export class FirstPasswordController {
  constructor(private readonly firstPassword: FirstPasswordService) {}

  @Post('first-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Sets the first password on an account that has none; 409 if one is already set.',
  })
  async set(@Body() dto: FirstPasswordDto, @Req() request: Request): Promise<void> {
    const user = request.user as JwtPayload;
    await this.firstPassword.set(user.sub, dto.password, requestContext(request));
  }
}
