import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
  Inject,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { CommunicationsService } from './communications.service';
import { BulkReminderService } from './reminders.service';
import { SingleReminderService } from './single-reminder.service';
import {
  SendCommunicationDto,
  QueryLastRemindersDto,
  LastReminderDto,
} from './dto/communications.dto';
import {
  SendBulkReminderDto,
  QueryReminderBatchesDto,
  QueryReminderBatchLogsDto,
} from './dto/reminders.dto';
import { SendSingleReminderDto } from './dto/single-reminder.dto';
import { UserRole, JwtPayload } from '@biddaloy/shared';
import { requestContext } from '../../common/request-context.util';

@ApiTags('communications')
@ApiTenantAuth()
@Controller('communications')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
export class CommunicationsController {
  constructor(
    @Inject(CommunicationsService) private readonly communicationsService: CommunicationsService,
    @Inject(BulkReminderService) private readonly bulkReminderService: BulkReminderService,
    @Inject(SingleReminderService) private readonly singleReminderService: SingleReminderService,
  ) {}

  // Distinct segment count from reminder/bulk(/:id) above and reminder/single/:studentId
  // below, so there's no route-ordering ambiguity — declared first to read
  // preview-before-send, matching the issue's "shows preview before sending."
  @Post('reminder/single/:studentId/preview')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @ApiOperation({
    summary: 'Render a single-student reminder without sending it, for the sender to review first.',
  })
  previewSingleReminder(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: SendSingleReminderDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.singleReminderService.preview(studentId, dto, tenant.id);
  }

  @Post('reminder/single/:studentId')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @ApiOperation({ summary: 'Send a fee reminder to one student/guardian.' })
  sendSingleReminder(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: SendSingleReminderDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.singleReminderService.sendSingle(
      studentId,
      dto,
      tenant.id,
      user.sub,
      requestContext(request),
    );
  }

  // Declared before the send route below, matching the single-reminder
  // pair above: preview-before-send is the reading order the epic mandates.
  //
  // Same STRICT_RATE_LIMIT as the send route it mirrors. Preview runs the
  // identical resolution work (student + guardian + dues loads for up to
  // 500 students) and hands back every guardian's name, channel and
  // contact address. On the default tier one ACCOUNTANT token could page
  // the tenant's whole guardian directory out through it; the fact that
  // nothing is sent makes it cheaper to abuse, not safer.
  @Post('reminder/bulk/preview')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary:
      'Resolve a bulk reminder without sending it — who would receive what, and who would be skipped and why.',
  })
  previewBulkReminder(
    @Body() dto: SendBulkReminderDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.bulkReminderService.previewBulk(dto, tenant.id, user.sub, requestContext(request));
  }

  // Declared before @Get(':id') — Nest matches in declaration order, and
  // 'reminder' would otherwise be swallowed by the UUID param route and
  // rejected by its ParseUUIDPipe.
  @Post('reminder/bulk')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary: 'Queue fee reminders to every student/guardian matching the given filters.',
  })
  sendBulkReminder(
    @Body() dto: SendBulkReminderDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.bulkReminderService.sendBulk(dto, tenant.id, user.sub, requestContext(request));
  }

  // Declared before @Get(':id') — same reasoning as the POST above:
  // 'reminder' would otherwise be swallowed by the UUID param route.
  @Get('reminder/bulk')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @ApiOperation({
    summary: 'Reminder History — every bulk reminder batch this tenant sent, newest first.',
  })
  findReminderBatches(
    @Query() query: QueryReminderBatchesDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.bulkReminderService.findBatches(query, tenant.id);
  }

  @Get('reminder/bulk/:id/logs')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @ApiOperation({
    summary: "One batch's per-recipient delivery records, for the batch detail page.",
  })
  findReminderBatchLogs(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryReminderBatchLogsDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.bulkReminderService.findBatchLogs(id, query, tenant.id);
  }

  @Get('reminder/bulk/:id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @ApiOperation({
    summary: 'Get a bulk reminder batch, including its per-recipient delivery status.',
  })
  findReminderBatch(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.bulkReminderService.findBatch(id, tenant.id);
  }

  @Post('send')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @ApiOperation({ summary: 'Send a freeform (non-reminder) message.' })
  send(
    @Body() dto: SendCommunicationDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.communicationsService.enqueue(dto, tenant.id, user.sub);
  }

  // Declared before `@Get(':id')` — same reasoning as `reminder/bulk`
  // above: 'last-reminders' would otherwise be swallowed by the UUID
  // param route and rejected by its ParseUUIDPipe.
  @Get('last-reminders')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @ApiOperation({
    summary: "Batch lookup of each student's most recent fee reminder, for [8.10.4]'s dues queue.",
  })
  @ApiOkResponse({ type: LastReminderDto, isArray: true })
  findLastReminders(
    @Query() query: QueryLastRemindersDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.communicationsService
      .findLastReminders(query.student_ids, tenant.id)
      .then((byStudent) =>
        Array.from(byStudent.entries()).map(([student_id, reminder]) => ({
          student_id,
          ...reminder,
        })),
      );
  }

  // Declared before `@Get(':id')` — same reasoning as `reminder/bulk`
  // above: 'student' would otherwise be swallowed by the UUID param route
  // and rejected by its ParseUUIDPipe.
  @Get('student/:studentId')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @ApiOperation({
    summary: "Get every message sent about a student's guardians, newest first.",
  })
  findByStudent(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.communicationsService.findByStudent(studentId, tenant.id);
  }

  // Declared before `@Get(':id')` — same reasoning as `student/:studentId`
  // above.
  @Get('guardian/:guardianId')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @ApiOperation({
    summary: 'Get every message sent directly to a guardian, newest first.',
  })
  findByGuardian(
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.communicationsService.findByGuardian(guardianId, tenant.id);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.communicationsService.findOne(id, tenant.id);
  }
}
