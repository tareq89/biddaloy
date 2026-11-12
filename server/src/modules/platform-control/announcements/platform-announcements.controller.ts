import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ApprovalScope } from '@biddaloy/shared';
import { IdempotencyInterceptor } from '../../../common/idempotency/idempotency.interceptor';
import { FailClosedWithoutRedis } from '../../../common/rate-limit/app-throttler.guard';
import { STRICT_RATE_LIMIT } from '../../../rate-limit';
import { RequireApproval } from '../../auth/decorators/require-approval.decorator';
import { ApprovalGuard } from '../../auth/guards/approval.guard';
import type { CockpitPrincipal } from '../../platform-identity/cockpit-principal';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import { TwoPersonGuard } from '../../platform-identity/approvals/two-person.guard';
import {
  AnnouncementDto,
  AnnouncementListDto,
  AnnouncementPreviewDto,
  ListAnnouncementsQueryDto,
  PreviewAnnouncementDto,
  SendAnnouncementDto,
} from './dto/platform-announcements.dto';
import { PlatformAnnouncementsService } from './platform-announcements.service';

const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** [Epic 99 D5, D30] Message every school's admins. Two owners must agree; sent once. No id params. */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/announcements')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class PlatformAnnouncementsController {
  constructor(
    private readonly announcements: PlatformAnnouncementsService,
    private readonly twoPerson: TwoPersonGuard,
  ) {}

  @Get()
  @ApiOperation({ summary: 'What was sent, newest first.' })
  async list(
    @Query() q: ListAnnouncementsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AnnouncementListDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.announcements.list(q.limit, q.offset);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'How many schools and people a send would reach. Writes nothing.' })
  async preview(
    @Body() dto: PreviewAnnouncementDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AnnouncementPreviewDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.announcements.preview(dto.statusFilter);
  }

  /**
   * The other owner's approval is checked inside the handler, after body validation, so a bad
   * body never files an approval request. Needs `Idempotency-Key` (Rule 25).
   */
  @Post()
  @FailClosedWithoutRedis()
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_ANNOUNCE_ALL)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary:
      'Send to the admins of every school in the filter. Needs a step-up token, the other owner and an Idempotency-Key.',
  })
  async send(
    @Body() dto: SendAnnouncementDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: { user: CockpitPrincipal },
    @Res({ passthrough: true }) res: Response,
  ): Promise<AnnouncementDto> {
    res.setHeader('Cache-Control', 'no-store');
    if (typeof key !== 'string' || !KEY_PATTERN.test(key))
      throw new BadRequestException(
        'Idempotency-Key is required: 1 to 64 letters, digits, dashes or underscores.',
      );
    await this.twoPerson.enforce(req, ApprovalScope.PLATFORM_ANNOUNCE_ALL, {
      action: 'Send an announcement to every school',
      title: dto.title,
      statusFilter: dto.statusFilter,
      sms: dto.sms,
      email: dto.email,
    });
    return this.announcements.send(req.user.sub, dto, key);
  }
}
