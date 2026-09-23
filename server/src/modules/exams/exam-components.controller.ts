import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { ExamComponentsService } from './exam-components.service';
import {
  CreateExamComponentDto,
  UpdateExamComponentDto,
  QueryExamComponentDto,
  CopyExamComponentsDto,
} from './dto/exams.dto';
import { Permission, UserRole, JwtPayload } from '@biddaloy/shared';

@ApiTags('exam-components')
@ApiTenantAuth()
@Controller('exams/:examId/components')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ExamComponentsController {
  constructor(private readonly service: ExamComponentsService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.EXAM_MANAGE)
  @ApiOperation({ summary: 'Add a component to an exam-subject.' })
  create(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Body() dto: CreateExamComponentDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.create(examId, dto, tenant.id, user.sub, requestContext(request));
  }

  @Get()
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.EXAM_MANAGE)
  @ApiOperation({ summary: 'List components for an exam, optionally filtered by subject.' })
  findAll(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: QueryExamComponentDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.findAll(examId, query.subject_id, tenant.id);
  }

  @Post('copy')
  // Ahead of ':id' below — Nest matches routes in declaration order, and
  // ':id' would otherwise swallow the literal 'copy' segment as a
  // (rejected-by-ParseUUIDPipe) id.
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.EXAM_MANAGE)
  @ApiOperation({ summary: 'Copy components from another subject/exam into one or more subjects.' })
  copy(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Body() dto: CopyExamComponentsDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.copy(examId, dto, tenant.id, user.sub, requestContext(request));
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.EXAM_MANAGE)
  findOne(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.findOne(examId, id, tenant.id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.EXAM_MANAGE)
  update(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExamComponentDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.update(examId, id, dto, tenant.id, user.sub, requestContext(request));
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.EXAM_MANAGE)
  remove(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.remove(examId, id, tenant.id, user.sub, requestContext(request));
  }
}
