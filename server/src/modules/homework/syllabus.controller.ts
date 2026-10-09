import {
  Body,
  Controller,
  Delete,
  Get,
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
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { SyllabusService } from './syllabus.service';
import {
  CreateSyllabusTopicDto,
  UpdateSyllabusTopicDto,
  ReorderSyllabusTopicsDto,
  toSyllabusTopicResponseDto,
} from './dto/syllabus.dto';
import { JwtPayload, Permission } from '@biddaloy/shared';

/**
 * [22.3.4] `GET /syllabus-topics` (`SYLLABUS_READ`) and the write routes
 * (`SYLLABUS_MANAGE`) for `SyllabusTopic` CRUD + reorder. `reorder` is a
 * `PATCH` (not `POST`, unlike `AcademicTermsController`) — it's a partial
 * update of existing rows' `sequence`, not a state-changing action.
 */
@ApiTags('syllabus-topics')
@ApiTenantAuth()
@Controller('syllabus-topics')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class SyllabusController {
  constructor(private readonly service: SyllabusService) {}

  @Get()
  @RequirePermissions(Permission.SYLLABUS_READ)
  @ApiOperation({ summary: 'List syllabus topics, optionally filtered by class/subject.' })
  async list(
    @Query('class_id', new ParseUUIDPipe({ optional: true })) classId: string | undefined,
    @Query('subject_id', new ParseUUIDPipe({ optional: true })) subjectId: string | undefined,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const topics = await this.service.findAll(tenant.id, classId, subjectId);
    return topics.map(toSyllabusTopicResponseDto);
  }

  @Post()
  @RequirePermissions(Permission.SYLLABUS_MANAGE)
  @ApiOperation({ summary: 'Create a syllabus topic.' })
  async create(
    @Body() dto: CreateSyllabusTopicDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const topic = await this.service.create(dto, tenant.id, user.sub, requestContext(request));
    return toSyllabusTopicResponseDto(topic);
  }

  @Patch('reorder')
  @RequirePermissions(Permission.SYLLABUS_MANAGE)
  @ApiOperation({ summary: 'Bulk-update the sequence of a set of syllabus topics.' })
  async reorder(
    @Body() dto: ReorderSyllabusTopicsDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const topics = await this.service.reorder(
      dto.items,
      tenant.id,
      user.sub,
      requestContext(request),
    );
    return topics.map(toSyllabusTopicResponseDto);
  }

  @Patch(':id')
  @RequirePermissions(Permission.SYLLABUS_MANAGE)
  @ApiOperation({ summary: 'Edit a syllabus topic (content and/or status).' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSyllabusTopicDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const topic = await this.service.update(id, dto, tenant.id, user.sub, requestContext(request));
    return toSyllabusTopicResponseDto(topic);
  }

  @Delete(':id')
  @RequirePermissions(Permission.SYLLABUS_MANAGE)
  @ApiOperation({ summary: 'Delete a syllabus topic.' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<{ deleted: true }> {
    await this.service.remove(id, tenant.id, user.sub, requestContext(request));
    return { deleted: true };
  }
}
