import {
  Controller,
  Get,
  Post,
  Patch,
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
import { MarksService } from './marks.service';
import { MarkGridService } from './mark-grid.service';
import { BatchMarksDto, GridQueryDto, GridStateActionDto, QueryProgressDto } from './dto/marks.dto';
import { Permission, UserRole, JwtPayload } from '@biddaloy/shared';

/**
 * `@Roles(...)` here is only the coarse gate ("a TEACHER may attempt this
 * at all") — `MarksAuthorizationService` is the real, object-level check
 * ("which section-subjects"), matching `attendance.controller.ts`'s same
 * two-layer pattern.
 */
@ApiTags('marks')
@ApiTenantAuth()
@Controller('exams/:examId/marks')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class MarksController {
  constructor(
    private readonly marksService: MarksService,
    private readonly gridService: MarkGridService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.TEACHER)
  @RequirePermissions(Permission.MARK_VIEW)
  @ApiOperation({
    summary:
      'Get one section-subject grid: students, components, marks, state, derived attendance.',
  })
  getGrid(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: GridQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.gridService.getGrid(
      examId,
      query.section_id,
      query.subject_id,
      tenant.id,
      tenant.role,
      user.sub,
    );
  }

  @Patch()
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @RequirePermissions(Permission.MARK_ENTER)
  @ApiOperation({ summary: 'Batch-upsert marks for a section-subject grid.' })
  upsertBatch(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Body() dto: BatchMarksDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.marksService.upsertBatch(
      examId,
      dto,
      tenant.id,
      tenant.role,
      user.sub,
      requestContext(request),
    );
  }

  @Post('submit')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @RequirePermissions(Permission.MARK_ENTER)
  @ApiOperation({ summary: 'Submit a section-subject grid (DRAFT -> SUBMITTED).' })
  submit(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Body() dto: GridStateActionDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.gridService.submit(
      examId,
      dto,
      tenant.id,
      tenant.role,
      user.sub,
      requestContext(request),
    );
  }

  @Post('reopen')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.MARK_ENTER)
  @ApiOperation({ summary: 'Reopen a submitted grid (SUBMITTED -> DRAFT). Admin only.' })
  reopen(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Body() dto: GridStateActionDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.gridService.reopen(
      examId,
      dto,
      tenant.id,
      tenant.role,
      user.sub,
      requestContext(request),
    );
  }

  @Get('progress')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.TEACHER)
  @RequirePermissions(Permission.MARK_VIEW)
  @ApiOperation({
    summary: 'Grid-submission progress for an exam: counts by state plus the outstanding list.',
  })
  progress(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: QueryProgressDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.gridService.progress(examId, tenant.id, query.state);
  }
}
