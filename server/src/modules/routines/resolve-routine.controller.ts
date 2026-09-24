import { Controller, Get, Query, UseGuards, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { ResolveRoutineService } from './resolve-routine.service';
import { ResolveRoutineQueryDto } from './dto/resolve.dto';
import { JwtPayload, Permission, UserRole } from '@biddaloy/shared';

const READ_ROLES = [
  UserRole.ADMIN,
  UserRole.EXECUTIVE,
  UserRole.TEACHER,
  UserRole.PARENT,
  UserRole.STUDENT,
];

/**
 * [21.5.1] D14: the one read path for "what is on, for whom, between
 * these dates". Every consumer — grid, agenda, portal, and later Epic
 * 41.0 attendance / Epic 37.0 online classes — calls this endpoint
 * rather than querying `routine_slots` itself.
 */
@ApiTags('routines')
@ApiTenantAuth()
@Controller('routines')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ResolveRoutineController {
  constructor(
    @Inject(ResolveRoutineService) private readonly resolveRoutineService: ResolveRoutineService,
  ) {}

  @Get('resolve')
  @Roles(...READ_ROLES)
  @RequirePermissions(Permission.ROUTINE_READ)
  @ApiOperation({
    summary: 'Resolve concrete, dated slots for a section, teacher or student.',
  })
  resolve(
    @Query() query: ResolveRoutineQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.resolveRoutineService.resolveRoutine(query, tenant.id, {
      role: tenant.role,
      userId: user.sub,
    });
  }
}
