import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtPayload, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { SurveyRespondService } from './survey-respond.service';
import { SurveyResultsService } from './survey-results.service';
import { PendingSurveyDto, RespondSurveyDto } from './dto/survey-respond.dto';

type Tenant = { id: string; role: string };

/**
 * [28.4.2] Family side. MUST be registered before `SurveysController` in the
 * module: that controller's `GET :id` would otherwise capture `mine`.
 */
@ApiTags('surveys')
@ApiTenantAuth()
@Controller('surveys')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.PARENT, UserRole.STUDENT)
export class SurveyRespondController {
  constructor(private readonly respondService: SurveyRespondService) {}

  @Get('mine')
  @ApiOperation({ summary: "OPEN surveys with the caller's pending teacher-subject pairs." })
  @ApiOkResponse({ type: [PendingSurveyDto] })
  mine(@CurrentTenant() tenant: Tenant, @CurrentUser() user: JwtPayload) {
    return this.respondService.listMine(tenant.role, user.sub, tenant.id);
  }

  @Post(':id/respond')
  @ApiOperation({ summary: 'Answer one teacher-subject pair, once (409 on repeat).' })
  respond(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespondSurveyDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.respondService.respond(id, dto, tenant.role, user.sub, tenant.id);
  }
}

/**
 * Results live on their own controller so a TEACHER reaches the service (and
 * gets 404) instead of a class-level ADMIN-only 403. ACR_READ is checked in
 * the service for the same reason.
 */
@ApiTags('surveys')
@ApiTenantAuth()
@Controller('surveys')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.TEACHER)
export class SurveyResultsController {
  constructor(private readonly resultsService: SurveyResultsService) {}

  @Get(':id/results')
  @ApiOperation({ summary: 'Aggregated results per teacher-subject, hidden below min_responses.' })
  results(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.resultsService.getResults(id, tenant.role, user.sub, tenant.id);
  }
}
