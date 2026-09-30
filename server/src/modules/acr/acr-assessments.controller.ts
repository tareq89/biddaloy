import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { AcrAssessmentsService } from './acr-assessments.service';
import {
  ListAcrAssessmentsQueryDto,
  StartAcrAssessmentDto,
  UpdateAcrAssessmentDto,
} from './dto/assessment.dto';

type Tenant = { id: string };
type Caller = { sub: string };

/** ACR assessments. The subject gets 404 everywhere (D2). 28.2.2. */
@ApiTags('acr')
@ApiTenantAuth()
@Controller('acr')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class AcrAssessmentsController {
  constructor(private readonly service: AcrAssessmentsService) {}

  @Post('assessments')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ACR_WRITE)
  @ApiOperation({ summary: 'Start an ACR (INCOMPLETE, latest form version).' })
  start(@Body() dto: StartAcrAssessmentDto, @CurrentTenant() t: Tenant, @CurrentUser() u: Caller) {
    return this.service.start(dto, t.id, u.sub);
  }

  @Get('assessments')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ACR_READ)
  @ApiOperation({ summary: 'ACR register (own ACR excluded).' })
  list(
    @Query() q: ListAcrAssessmentsQueryDto,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: Caller,
  ) {
    return this.service.list(t.id, u.sub, q);
  }

  @Get('assessments/:id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ACR_READ)
  @ApiOperation({ summary: 'One ACR.' })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: Caller,
  ) {
    return this.service.get(id, t.id, u.sub);
  }

  @Patch('assessments/:id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ACR_WRITE)
  @ApiOperation({ summary: 'Autosave step fields and scores.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAcrAssessmentDto,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: Caller,
  ) {
    return this.service.update(id, dto, t.id, u.sub);
  }

  @Post('assessments/:id/complete')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ACR_WRITE)
  @ApiOperation({ summary: 'Complete an ACR (all criteria scored).' })
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: Caller,
  ) {
    return this.service.complete(id, t.id, u.sub);
  }

  @Post('assessments/:id/reopen')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ACR_WRITE)
  @ApiOperation({ summary: 'Reopen a completed ACR.' })
  reopen(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: Caller,
  ) {
    return this.service.reopen(id, t.id, u.sub);
  }

  @Get('staff/:userId')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ACR_READ)
  @ApiOperation({ summary: "A staff member's ACR history." })
  history(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: Caller,
  ) {
    return this.service.history(userId, t.id, u.sub);
  }
}
