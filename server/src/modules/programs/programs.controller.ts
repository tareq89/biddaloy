import {
  Body,
  Controller,
  Delete,
  Get,
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
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtPayload, Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { ProgramsService } from './programs.service';
import {
  CreateMilestoneDto,
  CreateProgramDto,
  ListProgramsQuery,
  ProgramDeletedResultDto,
  RemoveMilestoneResultDto,
  ReorderMilestonesDto,
  UpdateMilestoneDto,
  UpdateProgramDto,
  toMilestoneDto,
  toProgramDto,
} from './dto/programs.dto';

/**
 * [34.1.3] `Program`/`ProgramMilestone` CRUD, archive, and the D23 delete
 * rules. Enrolment and recording endpoints come in 34.2.1. Gated by
 * `RequirePermissions` (`PROGRAM_READ` for reads, `PROGRAM_MANAGE` for writes).
 */
@ApiTags('programs')
@ApiTenantAuth()
@Controller('programs')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ProgramsController {
  constructor(private readonly programsService: ProgramsService) {}

  @Get()
  @RequirePermissions(Permission.PROGRAM_READ)
  @ApiOperation({ summary: 'List programs with milestone and active-enrolment counts.' })
  async list(
    @Query() query: ListProgramsQuery,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const rows = await this.programsService.list(tenant.id, query.include_archived ?? false);
    return rows.map(({ program, milestone_count, active_enrollment_count }) =>
      toProgramDto(program, { milestone_count, active_enrollment_count }),
    );
  }

  @Post()
  @RequirePermissions(Permission.PROGRAM_MANAGE)
  @ApiOperation({ summary: 'Create a program.' })
  async create(
    @Body() dto: CreateProgramDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const program = await this.programsService.create(
      tenant.id,
      user.sub,
      dto,
      requestContext(request),
    );
    return toProgramDto(program);
  }

  @Get(':id')
  @RequirePermissions(Permission.PROGRAM_READ)
  @ApiOperation({ summary: 'Get a program with its ordered milestones.' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const program = await this.programsService.findOne(id, tenant.id);
    const milestoneRows = await this.programsService.findMilestonesWithAchievementCounts(
      id,
      tenant.id,
    );
    const dto = toProgramDto(program);
    dto.milestones = milestoneRows.map(({ milestone, achievement_count }) =>
      toMilestoneDto(milestone, achievement_count),
    );
    return dto;
  }

  @Patch(':id')
  @RequirePermissions(Permission.PROGRAM_MANAGE)
  @ApiOperation({ summary: 'Update a program, including archiving it (is_active: false).' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProgramDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const program = await this.programsService.update(
      id,
      tenant.id,
      user.sub,
      dto,
      requestContext(request),
    );
    return toProgramDto(program);
  }

  @Delete(':id')
  @RequirePermissions(Permission.PROGRAM_MANAGE)
  @ApiOperation({
    summary:
      'Hard-delete a program. Refused with 409 if it has any enrolments — archive it instead (D23).',
  })
  @ApiOkResponse({ type: ProgramDeletedResultDto })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<{ deleted: true }> {
    await this.programsService.remove(id, tenant.id, user.sub, requestContext(request));
    return { deleted: true };
  }

  @Post(':id/milestones')
  @RequirePermissions(Permission.PROGRAM_MANAGE)
  @ApiOperation({ summary: "Append a milestone at the end of the program's sequence." })
  async addMilestone(
    @Param('id', ParseUUIDPipe) programId: string,
    @Body() dto: CreateMilestoneDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const milestone = await this.programsService.addMilestone(
      programId,
      tenant.id,
      user.sub,
      dto,
      requestContext(request),
    );
    return toMilestoneDto(milestone);
  }

  @Patch(':id/milestones/:milestoneId')
  @RequirePermissions(Permission.PROGRAM_MANAGE)
  @ApiOperation({ summary: 'Rename or redescribe a milestone.' })
  async updateMilestone(
    @Param('id', ParseUUIDPipe) programId: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @Body() dto: UpdateMilestoneDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const milestone = await this.programsService.updateMilestone(
      programId,
      milestoneId,
      tenant.id,
      user.sub,
      dto,
      requestContext(request),
    );
    return toMilestoneDto(milestone);
  }

  @Delete(':id/milestones/:milestoneId')
  @RequirePermissions(Permission.PROGRAM_MANAGE)
  @ApiOperation({
    summary:
      'Delete a milestone. Cascades its achievements — the response reports how many were ' +
      "removed for audit purposes. Read the count from GET /programs/:id's " +
      'milestones[].achievement_count *before* calling this, to show a confirm step (D23).',
  })
  @ApiOkResponse({ type: RemoveMilestoneResultDto })
  async removeMilestone(
    @Param('id', ParseUUIDPipe) programId: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<{ achievements_removed: number }> {
    return this.programsService.removeMilestone(
      programId,
      milestoneId,
      tenant.id,
      user.sub,
      requestContext(request),
    );
  }

  @Put(':id/milestones/order')
  @RequirePermissions(Permission.PROGRAM_MANAGE)
  @ApiOperation({ summary: "Rewrite the program's milestone order." })
  async reorder(
    @Param('id', ParseUUIDPipe) programId: string,
    @Body() dto: ReorderMilestonesDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const milestones = await this.programsService.reorder(
      programId,
      tenant.id,
      user.sub,
      dto.milestone_ids,
      requestContext(request),
    );
    return milestones.map(toMilestoneDto);
  }
}
