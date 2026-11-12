import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ApprovalScope,
  ImpersonationEndedBy,
  ImpersonationStatus,
  type ImpersonationSessionDto,
  type StartImpersonationResponse,
} from '@biddaloy/shared';
import { RequireApproval } from '../auth/decorators/require-approval.decorator';
import { ApprovalGuard } from '../auth/guards/approval.guard';
import type { CockpitPrincipal } from '../platform-identity/cockpit-principal';
import { PlatformAdminGuard } from '../platform-identity/platform-admin.guard';
import { ImpersonationCodeService } from './exchange/impersonation-code.service';
import { ImpersonationSessionService } from './sessions/impersonation-session.service';
import { ConsentGateService, type GateRequest } from './consent/consent-gate.service';
import {
  ListImpersonationQueryDto,
  RequestWriteDto,
  StartImpersonationDto,
} from './dto/platform-impersonation.dto';

/** [Epic 99] Cockpit "Login as": start, end and list sessions. Consent logic lives in the service. */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/impersonation')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class PlatformImpersonationController {
  constructor(
    private readonly sessions: ImpersonationSessionService,
    private readonly codes: ImpersonationCodeService,
    private readonly gate: ConsentGateService,
  ) {}

  /**
   * No IdempotencyInterceptor on purpose (Rule 25): the answer carries a one-time secret and the
   * interceptor would store it for 24 h. A double click is safe anyway: D23 says a start that goes
   * ACTIVE ends the older live session of the same (owner, school, person), so only the newest code
   * works. A REQUESTED start ends nothing. The body is never logged.
   */
  @Post()
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_LOGIN_AS)
  @ApiOperation({ summary: 'Start a Login as session. Needs a step-up token.' })
  async start(
    @Body() dto: StartImpersonationDto,
    @Req() req: GateRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StartImpersonationResponse> {
    res.setHeader('Cache-Control', 'no-store');
    const row = await this.gate.start(req, dto);
    const status = row.status as ImpersonationStatus; // entity column is a plain string
    if (status !== ImpersonationStatus.ACTIVE) return { id: row.id, status };
    return {
      id: row.id,
      status,
      code: await this.codes.issue(row.id),
      expiresAt: row.expires_at!.toISOString(),
    };
  }

  /** Owner of an EMERGENCY session asks the school's admins to let it write. */
  @Post(':id/request-write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_LOGIN_AS)
  @ApiOperation({ summary: 'Ask for write access on an emergency session. Needs a step-up token.' })
  async requestWrite(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestWriteDto,
    @Req() req: { user: CockpitPrincipal },
  ): Promise<void> {
    await this.gate.requestWrite(req.user.sub, id, dto.reason);
  }

  /** Either owner may end any session, not only their own; no step-up needed to end. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'End a session. 404 when unknown or already over.' })
  async end(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    if (!(await this.sessions.end(id, ImpersonationEndedBy.OWNER))) {
      throw new HttpException(
        {
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Session not found.',
          code: 'SESSION_NOT_FOUND',
        },
        HttpStatus.NOT_FOUND,
      );
    }
  }

  @Get()
  @ApiOperation({ summary: 'Live or recent sessions, both owners see all.' })
  async list(
    @Query() q: ListImpersonationQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ImpersonationSessionDto[]> {
    res.setHeader('Cache-Control', 'no-store');
    return q.scope === 'recent'
      ? this.sessions.listRecent({ limit: q.limit! })
      : this.sessions.listLive();
  }
}
