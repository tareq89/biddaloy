import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
  Inject,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { CommunicationsService } from './communications.service';
import { BulkReminderService } from './reminders.service';
import { SingleReminderService } from './single-reminder.service';
import { SendCommunicationDto } from './dto/communications.dto';
import { SendBulkReminderDto } from './dto/reminders.dto';
import { SendSingleReminderDto } from './dto/single-reminder.dto';
import { UserRole, JwtPayload } from '@beton-boi/shared';
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

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.communicationsService.findOne(id, tenant.id);
  }
}
