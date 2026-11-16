import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ModuleKey, Permission, type JwtPayload } from '@biddaloy/shared';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { RequiresModule } from '../auth/decorators/require-module.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AdmissionStageResultService, type ResultActor } from './admission-stage-result.service';
import {
  CutoffCommitDto,
  CutoffCommitResponseDto,
  CutoffPreviewDto,
  CutoffPreviewResponseDto,
  ListStageResultsDto,
  PutStageResultsDto,
  PutStageResultsResponseDto,
  StageResultListResponseDto,
} from './dto/stage-result.dto';

/** [71.G2.05] Stage results and cut-off. */
@ApiTags('admission')
@ApiTenantAuth()
@Controller('admission')
@RequiresModule(ModuleKey.admission)
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.ADMISSION_REVIEW)
export class AdmissionStageResultController {
  constructor(private readonly results: AdmissionStageResultService) {}

  private actor(user: JwtPayload, request: Request): ResultActor {
    const ctx = requestContext(request);
    return { userId: user.sub, ip: ctx.ip, userAgent: ctx.userAgent };
  }

  @Get('stages/:id/results')
  @ApiOperation({
    summary: 'Saved results of a stage, ordered by roll. Page size at most 100.',
  })
  @ApiOkResponse({ type: StageResultListResponseDto })
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListStageResultsDto,
    @CurrentTenant() tenant: { id: string },
  ) {
    return this.results.list(id, query.page ?? 1, query.limit ?? 50, tenant.id);
  }

  @Put('stages/:id/results')
  @ApiOperation({
    summary:
      'Record attendance and a score (or pass/fail) per applicant, up to 200 rows. Last write wins.',
  })
  @ApiOkResponse({ type: PutStageResultsResponseDto })
  put(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PutStageResultsDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.results.putResults(id, dto, tenant.id, this.actor(user, request));
  }

  @Post('stages/:id/cutoff/preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Who passes and who does not for a cut-off, without saving.' })
  @ApiOkResponse({ type: CutoffPreviewResponseDto })
  preview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CutoffPreviewDto,
    @CurrentTenant() tenant: { id: string },
  ) {
    return this.results.preview(id, dto.mode, dto.value, tenant.id);
  }

  @Post('stages/:id/cutoff/commit')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Mark the cut-off passers (plus add, minus remove) as passed. Repeating the same body gives the same result.',
  })
  @ApiOkResponse({ type: CutoffCommitResponseDto })
  commit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CutoffCommitDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.results.commit(id, dto, tenant.id, this.actor(user, request));
  }
}
