import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ImpersonationEndedBy } from '@biddaloy/shared';
import type {
  ImpersonationExchangeResponse,
  ImpersonationMeResponse,
  JwtPayload,
} from '@biddaloy/shared';
import { STRICT_RATE_LIMIT } from '../../../rate-limit';
import { FailClosedWithoutRedis } from '../../../common/rate-limit/app-throttler.guard';
import { AuthService } from '../../auth/auth.service';
import { ImpersonationSessionService } from '../sessions/impersonation-session.service';
import { ImpersonationCodeService } from './impersonation-code.service';
import { ImpersonationExchangeDto } from './dto/impersonation-exchange.dto';

const impOf = (req: Request) => {
  const imp = (req.user as JwtPayload).imp;
  if (!imp) throw new ForbiddenException('Not a support session');
  return imp;
};

/**
 * [99.2.02] The app host side of Login as. The exchange is public (the code is the credential);
 * `me` and `end` take the bearer token only, no tenant header. Wired by #3797.
 */
@ApiTags('auth')
@Controller('auth/impersonation')
export class ImpersonationExchangeController {
  constructor(
    private readonly codes: ImpersonationCodeService,
    private readonly sessions: ImpersonationSessionService,
    private readonly auth: AuthService,
  ) {}

  @Post('exchange')
  @FailClosedWithoutRedis()
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({ summary: 'Swap a one-time Login as code for a short access token.' })
  async exchange(@Body() dto: ImpersonationExchangeDto): Promise<ImpersonationExchangeResponse> {
    const s = await this.codes.redeem(dto.code);
    const access_token = await this.auth.mintImpersonationToken(
      s.userId,
      { sid: s.sid, pa: s.adminId },
      s.remainingSeconds,
    );
    return { access_token, sessionId: s.sid, expiresAt: s.expiresAt.toISOString() };
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: "Status of the caller's own Login as session, for the banner." })
  async me(@Req() req: Request): Promise<ImpersonationMeResponse> {
    const res = await this.codes.describe(impOf(req).sid);
    if (!res) throw new NotFoundException('Session not found');
    return res;
  }

  @Post('end')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: "End the caller's own Login as session." })
  async end(@Req() req: Request): Promise<void> {
    await this.sessions.end(impOf(req).sid, ImpersonationEndedBy.PERSON_TAB);
  }
}
