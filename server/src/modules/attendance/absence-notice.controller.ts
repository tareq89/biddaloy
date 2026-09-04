import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { AbsenceNoticeService } from './absence-notice.service';
import { AttendanceAccessService } from './attendance-access.service';
import {
  AbsenceNoticeDateDto,
  AbsenceNoticePreviewResponseDto,
  AbsenceNoticeSendResponseDto,
} from './dto/absence-notice.dto';

/**
 * Manual controls for [9.8]'s auto-absent guardian notification. Gated to
 * ADMIN/EXECUTIVE, not TEACHER — deciding whether to text every absent
 * child's guardian is a school-policy action, not a per-register one, even
 * though [9.4]'s cut-off sweep and a teacher's own `finalize: true` can
 * both trigger the same send automatically once the tenant has opted in
 * (`policy.autoAbsentNotification.enabled`).
 *
 * `preview` is declared before `send` and audited with
 * `REMINDER_PREVIEWED` for the same reason the fee-reminder preview route
 * is: it hands back every guardian's name, channel and contact address for
 * a filter, which is the same exposure a send has, minus the message.
 */
@ApiTags('attendance')
@ApiTenantAuth()
@Controller('attendance/sections/:sectionId/absence-notice')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
export class AbsenceNoticeController {
  constructor(
    private readonly absenceNoticeService: AbsenceNoticeService,
    private readonly attendanceAccessService: AttendanceAccessService,
  ) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({
    summary:
      'Resolves who an absence-notice send would message and who it would skip, without ' +
      'sending anything.',
  })
  @ApiOkResponse({ type: AbsenceNoticePreviewResponseDto })
  async preview(
    @Param('sectionId') sectionId: string,
    @Body() dto: AbsenceNoticeDateDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
    @Req() req: Request,
  ): Promise<AbsenceNoticePreviewResponseDto> {
    await this.attendanceAccessService.assertCanAccessSection(
      tenant.role,
      user.sub,
      sectionId,
      tenant.id,
    );
    return this.absenceNoticeService.previewAbsenceNotice({
      tenantId: tenant.id,
      sectionId,
      date: dto.date,
      userId: user.sub,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Post('send')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({
    summary:
      'Manual escape hatch for a school that leaves the scheduled sweep off, or wants a ' +
      "finalized register's notice sent immediately. Idempotent on the session's " +
      '`notified_at` — a second call the same day sends nothing.',
  })
  @ApiOkResponse({ type: AbsenceNoticeSendResponseDto })
  async send(
    @Param('sectionId') sectionId: string,
    @Body() dto: AbsenceNoticeDateDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
    @Req() req: Request,
  ): Promise<AbsenceNoticeSendResponseDto> {
    await this.attendanceAccessService.assertCanAccessSection(
      tenant.role,
      user.sub,
      sectionId,
      tenant.id,
    );
    return this.absenceNoticeService.sendAbsenceNotices({
      tenantId: tenant.id,
      sectionId,
      date: dto.date,
      initiatedByUserId: user.sub,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }
}
