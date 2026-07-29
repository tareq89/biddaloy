import { Controller, Post, Get, Body, Param, ParseUUIDPipe, UseGuards, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CommunicationsService } from './communications.service';
import { SendCommunicationDto } from './dto/communications.dto';
import { UserRole, JwtPayload } from '@beton-boi/shared';

@Controller('communications')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
export class CommunicationsController {
  constructor(@Inject(CommunicationsService) private readonly communicationsService: CommunicationsService) {}

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
