import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtPayload } from '@biddaloy/shared';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import { requestContext } from '../../common/request-context.util';
import { SchoolInviteService } from './school-invite.service';
import { SchoolInviteDto } from './dto/school-invite.dto';

/**
 * Signed-in, no tenant header: a person answers requests addressed to their
 * own account. Every id is paired with `request.user.sub`, so one user can
 * never act on another's request. After accepting, the client calls
 * `POST /auth/refresh`, which re-reads memberships.
 */
@ApiTags('auth')
@Controller('account/school-invites')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth('bearer')
export class SchoolInvitesController {
  constructor(private readonly invites: SchoolInviteService) {}

  @Get()
  @ApiOperation({ summary: "Lists the caller's pending requests to join a school." })
  @ApiOkResponse({ type: [SchoolInviteDto] })
  list(@Req() request: Request): Promise<SchoolInviteDto[]> {
    return this.invites.listMine((request.user as JwtPayload).sub);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({ summary: 'Accepts a request: the caller becomes a member of that school.' })
  async accept(@Param('id', ParseUUIDPipe) id: string, @Req() request: Request): Promise<void> {
    await this.invites.accept((request.user as JwtPayload).sub, id, requestContext(request));
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({ summary: 'Declines a request; no membership is created.' })
  async decline(@Param('id', ParseUUIDPipe) id: string, @Req() request: Request): Promise<void> {
    await this.invites.decline((request.user as JwtPayload).sub, id, requestContext(request));
  }
}
