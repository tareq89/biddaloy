import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { AcrCriteriaService } from './acr-criteria.service';
import { GetAcrCriteriaQueryDto, SaveAcrCriteriaDto } from './dto/criteria.dto';

/** Read / save (as new version) the tenant's ACR criteria. 28.2.1. */
@ApiTags('acr')
@ApiTenantAuth()
@Controller('acr/criteria')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class AcrCriteriaController {
  constructor(private readonly service: AcrCriteriaService) {}

  @Get()
  @RequirePermissions(Permission.ACR_READ)
  @ApiOperation({
    summary: 'Latest ACR criteria version, or the one named by ?versionId (an ACR keeps its own).',
  })
  getLatest(@Query() q: GetAcrCriteriaQueryDto, @CurrentTenant() tenant: { id: string }) {
    return q.versionId
      ? this.service.getByVersion(q.versionId, tenant.id)
      : this.service.getLatest(tenant.id);
  }

  @Put()
  @RequirePermissions(Permission.ACR_WRITE)
  @ApiOperation({ summary: 'Save the full criteria list as a new version.' })
  save(
    @Body() dto: SaveAcrCriteriaDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.save(dto, tenant.id, user.sub);
  }
}
