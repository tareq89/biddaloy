import { Controller, Get, Post, Body, Query, UseGuards, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { SubstitutionsService } from './substitutions.service';
import { UpsertSubstitutionDto, QuerySubstitutionsDto } from './dto/substitution.dto';
import { Permission, UserRole } from '@biddaloy/shared';

/** [21.5.1] Substitutions CRUD + log. D12: never touches `routine_slots`. */
@ApiTags('routines')
@ApiTenantAuth()
@Controller('routines/substitutions')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class SubstitutionsController {
  constructor(
    @Inject(SubstitutionsService) private readonly substitutionsService: SubstitutionsService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ROUTINE_MANAGE)
  @ApiOperation({ summary: 'Record a cover or a cancellation for one slot on one date.' })
  record(
    @Body() dto: UpsertSubstitutionDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.substitutionsService.record(dto, tenant.id, user.sub);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ROUTINE_MANAGE)
  @ApiOperation({ summary: 'Substitution log, filtered by date range, teacher or section.' })
  list(
    @Query() query: QuerySubstitutionsDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.substitutionsService.list(query, tenant.id);
  }
}
