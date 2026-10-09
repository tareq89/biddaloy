import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { ApplicationDecisionsService } from './application-decisions.service';
import { ApplicationDto } from './dto/application.dto';
import {
  ApproveApplicationDto,
  BulkApproveDto,
  BulkApproveResultDto,
  CancelApplicationDto,
  ConsiderApplicationDto,
  RejectApplicationDto,
} from './dto/decide.dto';

type Tenant = { id: string; role: UserRole };
type Actor = { sub: string };

/**
 * Decide rights come from the catalogue (D22) and are enforced by the service; the route
 * permission only says "may use applications at all". `bulk-approve` is declared before the
 * `:id` routes so the static path is never read as an id.
 */
@ApiTags('applications')
@ApiTenantAuth()
@Controller('applications')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ApplicationDecisionsController {
  constructor(private readonly service: ApplicationDecisionsService) {}

  @Post('bulk-approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.APPLICATION_SUBMIT)
  @ApiOperation({ summary: 'Approve up to 50 applications; one failure never stops the rest' })
  @ApiOkResponse({ type: [BulkApproveResultDto] })
  bulkApprove(
    @Body() dto: BulkApproveDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: Actor,
    @Req() req: Request,
  ): Promise<BulkApproveResultDto[]> {
    return this.service.bulkApprove(tenant.id, { userId: user.sub, role: tenant.role }, dto, req);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.APPLICATION_SUBMIT)
  @ApiOperation({ summary: 'Approve the current step (the final step runs the effect)' })
  @ApiOkResponse({ type: ApplicationDto })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveApplicationDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: Actor,
    @Req() req: Request,
  ): Promise<ApplicationDto> {
    return this.service.approve(tenant.id, { userId: user.sub, role: tenant.role }, id, dto, req);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.APPLICATION_SUBMIT)
  @ApiOperation({ summary: 'Reject an open application (reason required)' })
  @ApiOkResponse({ type: ApplicationDto })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectApplicationDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: Actor,
    @Req() req: Request,
  ): Promise<ApplicationDto> {
    return this.service.reject(tenant.id, { userId: user.sub, role: tenant.role }, id, dto, req);
  }

  @Post(':id/consider')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.APPLICATION_SUBMIT)
  @ApiOperation({ summary: 'Mark an application under consideration (the step does not advance)' })
  @ApiOkResponse({ type: ApplicationDto })
  consider(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConsiderApplicationDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: Actor,
    @Req() req: Request,
  ): Promise<ApplicationDto> {
    return this.service.consider(tenant.id, { userId: user.sub, role: tenant.role }, id, dto, req);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.APPLICATION_SUBMIT)
  @ApiOperation({ summary: 'Cancel an approved leave application (reverses the effect)' })
  @ApiOkResponse({ type: ApplicationDto })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelApplicationDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: Actor,
    @Req() req: Request,
  ): Promise<ApplicationDto> {
    return this.service.cancel(tenant.id, { userId: user.sub, role: tenant.role }, id, dto, req);
  }
}
