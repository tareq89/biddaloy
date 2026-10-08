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
  Put,
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
import { StudyPlanCaller, StudyPlansService } from './study-plans.service';
import {
  CopyToSectionDto,
  CreateStudyPlanDto,
  ListStudyPlansQueryDto,
  ReplaceLessonsDto,
  SetExamMarkersDto,
  UpdateStudyPlanDto,
} from './dto/study-plan.dto';

type Tenant = { id: string; role: string };

/**
 * [66.2.01/#2006] Study plan routes. Permission guards only say "may use the
 * feature"; the owner scope (D6/D28) is enforced in `StudyPlansService`.
 * Literal paths must stay above `:id` (the `/routines/:id` shadowing bug).
 */
@ApiTags('study-plans')
@ApiTenantAuth()
@Controller('study-plans')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class StudyPlansController {
  constructor(private readonly service: StudyPlansService) {}

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
  @ApiOperation({ summary: 'List study plans the caller can read.' })
  list(
    @Query() query: ListStudyPlansQueryDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.findAll(query, tenant.id, this.caller(tenant, user, request));
  }

  @Post()
  @RequirePermissions(Permission.SYLLABUS_MANAGE)
  @ApiOperation({ summary: 'Create a study plan for a section and subject.' })
  create(
    @Body() dto: CreateStudyPlanDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.create(dto, tenant.id, this.caller(tenant, user, request));
  }

  @Get(':id')
  @RequirePermissions(Permission.SYLLABUS_READ)
  @ApiOperation({ summary: 'Read one study plan with owners and exam markers.' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.findOneForCaller(id, tenant.id, this.caller(tenant, user, request));
  }

  @Patch(':id')
  @RequirePermissions(Permission.SYLLABUS_MANAGE)
  @ApiOperation({ summary: 'Reassign the plan owner (administrator only).' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudyPlanDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.setOwnerOverride(
      id,
      dto.owner_override_teacher_id,
      tenant.id,
      this.caller(tenant, user, request),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.SYLLABUS_MANAGE)
  @ApiOperation({ summary: 'Soft-delete a study plan.' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    await this.service.remove(id, tenant.id, this.caller(tenant, user, request));
  }

  @Put(':id/lessons')
  @RequirePermissions(Permission.SYLLABUS_MANAGE)
  @ApiOperation({ summary: 'Replace the whole ordered lesson list.' })
  replaceLessons(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceLessonsDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.replaceLessons(
      id,
      dto.lessons,
      tenant.id,
      this.caller(tenant, user, request),
    );
  }

  @Put(':id/exam-markers')
  @RequirePermissions(Permission.SYLLABUS_MANAGE)
  @ApiOperation({ summary: 'Set the exam markers (one per exam).' })
  setExamMarkers(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetExamMarkersDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.setExamMarkers(
      id,
      dto.markers,
      tenant.id,
      this.caller(tenant, user, request),
    );
  }

  @Post(':id/copy-to-section')
  @RequirePermissions(Permission.SYLLABUS_MANAGE)
  @ApiOperation({ summary: 'Copy this plan to another section of the same year.' })
  copyToSection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CopyToSectionDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.copyToSection(
      id,
      dto.section_id,
      tenant.id,
      this.caller(tenant, user, request),
    );
  }
}
