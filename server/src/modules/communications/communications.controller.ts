import { Controller, Post, Get, Body, Param, ParseUUIDPipe, UseGuards, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CommunicationsService } from './communications.service';
import { BulkReminderService } from './reminders.service';
import { SendCommunicationDto } from './dto/communications.dto';
import { SendBulkReminderDto } from './dto/reminders.dto';
import { UserRole, JwtPayload } from '@beton-boi/shared';

@Controller('communications')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
export class CommunicationsController {
  constructor(
    @Inject(CommunicationsService) private readonly communicationsService: CommunicationsService,
    @Inject(BulkReminderService) private readonly bulkReminderService: BulkReminderService,
  ) {}

  // Declared before @Get(':id') — Nest matches in declaration order, and
  // 'reminder' would otherwise be swallowed by the UUID param route and
  // rejected by its ParseUUIDPipe.
  @Post('reminder/bulk')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  sendBulkReminder(
    @Body() dto: SendBulkReminderDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bulkReminderService.sendBulk(dto, tenant.id, user.sub);
  }

  @Get('reminder/bulk/:id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  findReminderBatch(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.bulkReminderService.findBatch(id, tenant.id);
  }

  @Post('send')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  send(
    @Body() dto: SendCommunicationDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.communicationsService.enqueue(dto, tenant.id, user.sub);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.communicationsService.findOne(id, tenant.id);
  }
}
