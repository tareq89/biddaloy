import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@biddaloy/shared';
import type { CockpitPrincipal } from '../../platform-identity/cockpit-principal';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import { PlatformHomeService } from '../../platform-identity/platform-home.service';
import { AttentionQueryService } from './attention-query.service';
import {
  AlertItemDto,
  AlertItemsPageDto,
  AttentionSummaryDto,
  SeenResultDto,
} from './dto/alert-item.dto';
import {
  ItemsQueryDto,
  LocaleQueryDto,
  SeenDto,
  SnoozeDto,
  SummaryQueryDto,
} from './dto/attention-query.dto';

type OwnerReq = { user: CockpitPrincipal };

/**
 * [Epic 98] The cockpit's own alerts. Same query service as the staff bar (no second query path):
 * tenant = the platform home school, recipient = the signed-in owner, role = SUPER_ADMIN. Every
 * read and write is scoped by that user id, so an owner never sees the other owner's alerts.
 */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/attention')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class PlatformAttentionController {
  constructor(
    private readonly attention: AttentionQueryService,
    private readonly home: PlatformHomeService,
  ) {}

  private async homeId(): Promise<string> {
    const id = await this.home.id();
    // No platform home yet: nothing can be addressed, and the answer is the same as a refusal.
    if (!id) throw new ForbiddenException('This area is for platform owners only');
    return id;
  }

  @Get()
  @ApiOperation({ summary: "The signed-in owner's alert worklist (tab=active) or history." })
  @ApiOkResponse({ type: AlertItemsPageDto })
  async items(@Req() req: OwnerReq, @Query() query: ItemsQueryDto): Promise<AlertItemsPageDto> {
    return this.attention.items(await this.homeId(), req.user.sub, UserRole.SUPER_ADMIN, query);
  }

  @Get('summary')
  @ApiOperation({ summary: "The signed-in owner's attention bar counts and top item." })
  @ApiOkResponse({ type: AttentionSummaryDto })
  async summary(
    @Req() req: OwnerReq,
    @Query() query: SummaryQueryDto,
  ): Promise<AttentionSummaryDto> {
    return this.attention.summary(await this.homeId(), req.user.sub, UserRole.SUPER_ADMIN, query);
  }

  @Post('items/seen')
  @HttpCode(200)
  @ApiOperation({ summary: "Mark the owner's own items as seen." })
  @ApiOkResponse({ type: SeenResultDto })
  async seen(@Req() req: OwnerReq, @Body() dto: SeenDto): Promise<SeenResultDto> {
    return this.attention.markSeen(await this.homeId(), req.user.sub, dto.recipientIds);
  }

  @Post('items/:recipientId/hide')
  @HttpCode(200)
  @ApiOperation({ summary: "Close (hide) one of the owner's non-critical items." })
  @ApiOkResponse({ type: AlertItemDto })
  async hide(
    @Req() req: OwnerReq,
    @Param('recipientId', ParseUUIDPipe) recipientId: string,
    @Query() query: LocaleQueryDto,
  ): Promise<AlertItemDto> {
    return this.attention.hide(
      await this.homeId(),
      req.user.sub,
      recipientId,
      query.locale,
      UserRole.SUPER_ADMIN,
    );
  }

  @Post('items/:recipientId/snooze')
  @HttpCode(200)
  @ApiOperation({ summary: "Snooze one of the owner's non-critical items." })
  @ApiOkResponse({ type: AlertItemDto })
  async snooze(
    @Req() req: OwnerReq,
    @Param('recipientId', ParseUUIDPipe) recipientId: string,
    @Body() dto: SnoozeDto,
    @Query() query: LocaleQueryDto,
  ): Promise<AlertItemDto> {
    return this.attention.snooze(
      await this.homeId(),
      req.user.sub,
      recipientId,
      dto,
      new Date(),
      query.locale,
      UserRole.SUPER_ADMIN,
    );
  }
}
