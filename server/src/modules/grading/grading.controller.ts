import {
  Body,
  Controller,
  Delete,
  Get,
  InternalServerErrorException,
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
import type { Request } from 'express';
import { ApprovalScope, JwtPayload, Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ApprovalGuard, ApprovalContext } from '../auth/guards/approval.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { RequireApproval } from '../auth/decorators/require-approval.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { GradingService } from './grading.service';
import { RecomputeService } from './recompute.service';
import {
  CreateGradingScaleDto,
  UpdateGradingScaleDto,
  CopyScaleDto,
  RecomputeBandsDto,
  toGradingScaleDto,
  toGradingBandDto,
} from './dto/grading.dto';

/**
 * [20.2.1] `GradingScale` CRUD + copy (guarded by `GRADING_SCALE_MANAGE`
 * alone) and the band recompute preview/confirm pair (`confirm` is also
 * gated by `@RequireApproval(GRADING_SCALE_MANAGE)` — see
 * `RecomputeService`'s doc comment for why).
 */
@ApiTags('grading')
@ApiTenantAuth()
@Controller('grading/scales')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard, ApprovalGuard)
export class GradingController {
  constructor(
    private readonly gradingService: GradingService,
    private readonly recomputeService: RecomputeService,
  ) {}

  private requireApproval(request: Request): ApprovalContext {
    const approval = (request as unknown as { approval?: ApprovalContext }).approval;
    if (!approval) {
      throw new InternalServerErrorException(
        'ApprovalGuard did not run before a grading-scale recompute — @RequireApproval guard misconfigured',
      );
    }
    return approval;
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.GRADING_SCALE_MANAGE)
  @ApiOperation({ summary: 'Create a grading scale (no bands yet).' })
  async create(
    @Body() dto: CreateGradingScaleDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const scale = await this.gradingService.create(tenant.id, user.sub, dto);
    return toGradingScaleDto(scale, []);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.GRADING_SCALE_MANAGE)
  @ApiOperation({ summary: 'List grading scales, optionally filtered by academic year.' })
  async findAll(
    @Query('academic_year_id') academicYearId: string | undefined,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const scales = await this.gradingService.findAll(tenant.id, academicYearId);
    const withBands = await Promise.all(
      scales.map(async (scale) => {
        const bands = await this.gradingService.findBands(scale.id, tenant.id);
        return toGradingScaleDto(scale, bands);
      }),
    );
    return withBands;
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.GRADING_SCALE_MANAGE)
  @ApiOperation({ summary: 'Get one grading scale with its bands.' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const scale = await this.gradingService.findOne(id, tenant.id);
    const bands = await this.gradingService.findBands(scale.id, tenant.id);
    return toGradingScaleDto(scale, bands);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.GRADING_SCALE_MANAGE)
  @ApiOperation({ summary: 'Rename a grading scale.' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGradingScaleDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const scale = await this.gradingService.update(id, tenant.id, user.sub, dto);
    const bands = await this.gradingService.findBands(scale.id, tenant.id);
    return toGradingScaleDto(scale, bands);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.GRADING_SCALE_MANAGE)
  @ApiOperation({ summary: 'Soft-delete a grading scale and its bands.' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ): Promise<{ deleted: true }> {
    await this.gradingService.remove(id, tenant.id, user.sub);
    return { deleted: true };
  }

  @Post(':id/copy')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.GRADING_SCALE_MANAGE)
  @ApiOperation({
    summary: "Copy another scale's bands onto this scale. Refused if this scale already has bands.",
  })
  async copy(
    @Param('id', ParseUUIDPipe) targetId: string,
    @Body() dto: CopyScaleDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const bands = await this.gradingService.copy(
      dto.source_scale_id,
      targetId,
      tenant.id,
      user.sub,
    );
    return bands.map(toGradingBandDto);
  }

  @Post(':id/bands/preview')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.GRADING_SCALE_MANAGE)
  @ApiOperation({
    summary: 'Validate a proposed band set and report what would change. Writes nothing.',
  })
  async previewBands(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecomputeBandsDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.recomputeService.preview(id, tenant.id, dto.bands);
  }

  @Post(':id/bands/confirm')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.GRADING_SCALE_MANAGE)
  @RequireApproval(ApprovalScope.GRADING_SCALE_MANAGE)
  @ApiOperation({
    summary:
      'Replace the band set, bump revision, and recompute affected results. Requires a fresh ' +
      'X-Approval-Token for "grading_scale.manage".',
  })
  async confirmBands(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecomputeBandsDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const approval = this.requireApproval(request);
    const result = await this.recomputeService.confirm(
      id,
      tenant.id,
      user.sub,
      approval.approverId,
      dto.bands,
    );
    return {
      scale: toGradingScaleDto(result.scale, result.bands),
      affected_result_count: result.affected_result_count,
    };
  }
}
