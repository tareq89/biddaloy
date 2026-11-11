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
  ImpersonationEntryKind,
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
import { ListImpersonationQueryDto, StartImpersonationDto } from './dto/platform-impersonation.dto';

/** [Epic 99] Cockpit "Login as": start, end and list sessions. Consent logic lives in the service. */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/impersonation')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class PlatformImpersonationController {
  constructor(
    private readonly sessions: ImpersonationSessionService,
    private readonly codes: ImpersonationCodeService,
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
    @Req() req: { user: CockpitPrincipal },
    @Res({ passthrough: true }) res: Response,
  ): Promise<StartImpersonationResponse> {
    res.setHeader('Cache-Control', 'no-store');
    const row = await this.sessions.create({
      platformAdminId: req.user.sub,
      schoolId: dto.schoolId,
      targetUserId: dto.targetUserId,
      role: dto.role,
      reason: dto.reason,
      viewOnly: dto.viewOnly,
      entryKind: ImpersonationEntryKind.NORMAL, // emergency is #3802
    });
    const status = row.status as ImpersonationStatus; // entity column is a plain string
    if (status !== ImpersonationStatus.ACTIVE) return { id: row.id, status };
    return {
      id: row.id,
      status,
      code: await this.codes.issue(row.id),
      expiresAt: row.expires_at!.toISOString(),
    };
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
