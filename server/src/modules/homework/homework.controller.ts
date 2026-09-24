import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { HomeworkService } from './homework.service';
import {
  AssignHomeworkDto,
  CreateHomeworkDto,
  HomeworkAssignmentResponseDto,
  HomeworkResponseDto,
  QueryHomeworkDto,
  UpdateHomeworkAssignmentDto,
} from './dto/homework.dto';

/**
 * `@Roles(...)` is the coarse gate; `HomeworkAccessService` (injected inside
 * `HomeworkService`) is the real, object-level gate on every mutating route.
 */
@ApiTags('homework')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class HomeworkController {
  constructor(private readonly homeworkService: HomeworkService) {}

  @Post('homework')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @RequirePermissions(Permission.HOMEWORK_ASSIGN)
  @ApiOperation({ summary: 'Create a Homework for a subject/class.' })
  @ApiOkResponse({ type: HomeworkResponseDto })
  async create(
    @Body() dto: CreateHomeworkDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.homeworkService.create(dto, {
      role: tenant.role,
      userId: user.sub,
      tenantId: tenant.id,
    });
  }

  @Get('homework')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.ACCOUNTANT, UserRole.TEACHER)
  @RequirePermissions(Permission.HOMEWORK_READ)
  @ApiOperation({ summary: 'List homework, filtered by class/section/subject/status.' })
  @ApiOkResponse({ type: HomeworkResponseDto, isArray: true })
  async findAll(
    @Query() query: QueryHomeworkDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.homeworkService.findAll(query, {
      role: tenant.role,
      userId: user.sub,
      tenantId: tenant.id,
    });
  }

  @Get('homework/:id')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.ACCOUNTANT, UserRole.TEACHER)
  @RequirePermissions(Permission.HOMEWORK_READ)
  @ApiOperation({ summary: 'One Homework by id.' })
  @ApiOkResponse({ type: HomeworkResponseDto })
  async findOne(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.homeworkService.findOne(id, {
      role: tenant.role,
      userId: user.sub,
      tenantId: tenant.id,
    });
  }

  @Post('homework/:id/assign')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @RequirePermissions(Permission.HOMEWORK_ASSIGN)
  @ApiOperation({ summary: 'Assign a Homework to a section or a single student (D24).' })
  @ApiOkResponse({ type: HomeworkAssignmentResponseDto })
  async assign(
    @Param('id') id: string,
    @Body() dto: AssignHomeworkDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.homeworkService.assign(id, dto, {
      role: tenant.role,
      userId: user.sub,
      tenantId: tenant.id,
    });
  }

  @Post('homework-assignments/:id/reassign')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @RequirePermissions(Permission.HOMEWORK_ASSIGN)
  @ApiOperation({
    summary:
      'Reassign — creates a new HomeworkAssignment row (D20); the old row is marked SUPERSEDED.',
  })
  @ApiOkResponse({ type: HomeworkAssignmentResponseDto })
  async reassign(
    @Param('id') id: string,
    @Body() dto: AssignHomeworkDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.homeworkService.reassign(id, dto, {
      role: tenant.role,
      userId: user.sub,
      tenantId: tenant.id,
    });
  }

  @Patch('homework-assignments/:id')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @RequirePermissions(Permission.HOMEWORK_ASSIGN)
  @ApiOperation({ summary: 'Deactivate or reactivate an assignment (Q10 D22).' })
  @ApiOkResponse({ type: HomeworkAssignmentResponseDto })
  async updateAssignment(
    @Param('id') id: string,
    @Body() dto: UpdateHomeworkAssignmentDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.homeworkService.updateAssignment(id, dto, {
      role: tenant.role,
      userId: user.sub,
      tenantId: tenant.id,
    });
  }
}
