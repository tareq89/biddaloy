import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtPayload, Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { StudyPlanCaller } from './study-plans.service';
import { StudyPlanTemplatesService } from './study-plan-templates.service';
import {
  CopyStudyPlanTemplateDto,
  CreateStudyPlanTemplateDto,
  FromPlanDto,
  ListStudyPlanTemplatesQueryDto,
  UpdateStudyPlanTemplateDto,
} from './dto/study-plan-template.dto';

type Tenant = { id: string; role: string };

/**
 * [66.2.06/#2011] Study-plan template library. Literal `from-plan/...` stays
 * above `:id`. Copy needs SYLLABUS_MANAGE; the owner scope is enforced by
 * `StudyPlansService.create`.
 */
@ApiTags('study-plan-templates')
@ApiTenantAuth()
@Controller('study-plan-templates')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class StudyPlanTemplatesController {
  constructor(private readonly service: StudyPlanTemplatesService) {}

  private caller(tenant: Tenant, user: JwtPayload, request: Request): StudyPlanCaller {
    return {
      userId: user.sub,
      tenantId: tenant.id,
      role: tenant.role,
      context: requestContext(request),
    };
  }

  @Get()
  @RequirePermissions(Permission.SYLLABUS_READ)
  @ApiOperation({ summary: 'List study plan templates.' })
  list(@Query() query: ListStudyPlanTemplatesQueryDto, @CurrentTenant() tenant: Tenant) {
    return this.service.list(query, tenant.id);
  }

  @Post()
  @RequirePermissions(Permission.STUDY_PLAN_TEMPLATE_MANAGE)
  @ApiOperation({ summary: 'Create a study plan template.' })
  create(
    @Body() dto: CreateStudyPlanTemplateDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.create(dto, tenant.id, user.sub, requestContext(request));
  }

  @Post('from-plan/:planId')
  @RequirePermissions(Permission.STUDY_PLAN_TEMPLATE_MANAGE)
  @ApiOperation({ summary: 'Save a study plan as a template.' })
  fromPlan(
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() dto: FromPlanDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.fromPlan(planId, dto.name, tenant.id, this.caller(tenant, user, request));
  }

  @Get(':id')
  @RequirePermissions(Permission.SYLLABUS_READ)
  @ApiOperation({ summary: 'Read one template with its lessons.' })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() tenant: Tenant) {
    return this.service.get(id, tenant.id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.STUDY_PLAN_TEMPLATE_MANAGE)
  @ApiOperation({ summary: 'Edit a template.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudyPlanTemplateDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.update(id, dto, tenant.id, user.sub, requestContext(request));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.STUDY_PLAN_TEMPLATE_MANAGE)
  @ApiOperation({ summary: 'Soft-delete a template; plans copied from it are untouched.' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    await this.service.remove(id, tenant.id, user.sub, requestContext(request));
  }

  @Post(':id/copy')
  @RequirePermissions(Permission.SYLLABUS_MANAGE)
  @ApiOperation({ summary: 'Copy a template into a new study plan of the caller.' })
  copy(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CopyStudyPlanTemplateDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.copy(id, dto, tenant.id, this.caller(tenant, user, request));
  }
}
