import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { AttendanceService } from './attendance.service';
import { QueryAuditLogDto } from '../audit/dto/audit-log.dto';
import {
  CorrectRecordDto,
  FinalizeRegisterDto,
  MySectionDto,
  PutRegisterDto,
  QueryMySectionsDto,
  QueryRegisterDto,
  RecordHistoryResponseDto,
  RegisterResponseDto,
} from './dto/attendance.dto';

/**
 * `@Roles(...)` below is only the coarse gate — "a caller with this role may
 * attempt this endpoint at all". The real, object-level gate is
 * `AttendanceAccessService`, called from every `AttendanceService` method
 * before it touches a section's data: a TEACHER passes `@Roles` on every
 * route here but is still 403'd by the service for a section they aren't
 * mapped to in `teacher_class_sections`.
 */
@ApiTags('attendance')
@ApiTenantAuth()
@Controller('attendance')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get('my-sections')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.ACCOUNTANT, UserRole.TEACHER)
  @ApiOperation({
    summary:
      "The caller's landing screen — every section they may mark, with today's marking progress.",
  })
  @ApiOkResponse({ type: MySectionDto, isArray: true })
  async listMySections(
    @Query() query: QueryMySectionsDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.attendanceService.listMySections({
      role: tenant.role,
      userId: user.sub,
      tenantId: tenant.id,
      date: query.date,
    });
  }

  @Get('sections/:sectionId/register')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.ACCOUNTANT, UserRole.TEACHER)
  @ApiOperation({ summary: "A section's register for one day (and optionally one period)." })
  @ApiOkResponse({ type: RegisterResponseDto })
  async getRegister(
    @Param('sectionId') sectionId: string,
    @Query() query: QueryRegisterDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.attendanceService.getRegister({
      sectionId,
      date: query.date,
      periodNo: query.period_no ?? null,
      tenantId: tenant.id,
      role: tenant.role,
      userId: user.sub,
    });
  }

  @Put('sections/:sectionId/register')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.TEACHER)
  @ApiOperation({
    summary:
      'Submits the whole register for one section, one day. Idempotent on `client_request_id` ' +
      'and conflict-checked on `base_version` — a replayed request returns 200 and writes ' +
      'nothing, and a stale `base_version` returns 409 with the current register.',
  })
  @ApiOkResponse({ type: RegisterResponseDto })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description:
      "base_version does not match the session's current version. `details.current_version` " +
      'and `details.register` (the same shape as GET .../register) let the client refresh and ' +
      'retry without a second round trip.',
    schema: {
      example: {
        statusCode: 409,
        message: 'This register has changed since you last loaded it',
        timestamp: '2026-01-01T00:00:00.000Z',
        path: '/attendance/sections/:sectionId/register',
        requestId: 'req-id',
        details: {
          code: 'ATTENDANCE_VERSION_CONFLICT',
          current_version: 3,
          register: {},
        },
      },
    },
  })
  async putRegister(
    @Param('sectionId') sectionId: string,
    @Body() dto: PutRegisterDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
    @Req() req: Request,
  ) {
    return this.attendanceService.putRegister({
      sectionId,
      dto,
      tenantId: tenant.id,
      role: tenant.role,
      userId: user.sub,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Post('sections/:sectionId/register/finalize')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.TEACHER)
  @ApiOperation({
    summary:
      'Finalizes an already-submitted register without resubmitting marks. Idempotent — ' +
      'finalizing an already-finalized register is a 200 no-op.',
  })
  @ApiOkResponse({ type: RegisterResponseDto })
  async finalize(
    @Param('sectionId') sectionId: string,
    @Body() dto: FinalizeRegisterDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
    @Req() req: Request,
  ) {
    return this.attendanceService.finalize({
      sectionId,
      date: dto.date,
      periodNo: dto.period_no ?? null,
      tenantId: tenant.id,
      role: tenant.role,
      userId: user.sub,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Patch('records/:recordId')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.TEACHER)
  @ApiOperation({
    summary:
      'Corrects one existing mark. `reason` is always required — this route only ever edits ' +
      "something that already exists. Outside the tenant's correction window this additionally " +
      'requires ATTENDANCE_CORRECT.',
  })
  @ApiOkResponse({ type: RegisterResponseDto })
  async correctRecord(
    @Param('recordId') recordId: string,
    @Body() dto: CorrectRecordDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
    @Req() req: Request,
  ) {
    return this.attendanceService.correctRecord({
      recordId,
      dto,
      tenantId: tenant.id,
      role: tenant.role,
      userId: user.sub,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Get('records/:recordId/history')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.ACCOUNTANT, UserRole.TEACHER)
  @ApiOperation({
    summary:
      "One mark's correction history. Gated on ATTENDANCE_READ plus section access — not " +
      'AUDIT_LOG_READ — so a TEACHER can see who changed a mark in their own register without ' +
      'being handed the tenant-wide audit log to get it.',
  })
  @ApiOkResponse({ type: RecordHistoryResponseDto })
  async getRecordHistory(
    @Param('recordId') recordId: string,
    @Query() query: QueryAuditLogDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.attendanceService.getRecordHistory({
      recordId,
      query,
      tenantId: tenant.id,
      role: tenant.role,
      userId: user.sub,
    });
  }
}
