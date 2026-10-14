import { Controller, Get, Query, UseGuards, Inject, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { ResolveRoutineService } from './resolve-routine.service';
import { ResolveRoutineQueryDto } from './dto/resolve.dto';
import { FamilyAccessService } from '../students/family-access.service';
import { JwtPayload, Permission, isGuardianRole } from '@biddaloy/shared';

/**
 * [21.5.1] D14: the one read path for "what is on, for whom, between
 * these dates". Every consumer — grid, agenda, portal, and later Epic
 * 41.0 attendance / Epic 37.0 online classes — calls this endpoint
 * rather than querying `routine_slots` itself.
 *
 * A PARENT or STUDENT must use `student_id` for a student they are linked
 * to; the check lives here, not in the service, because attendance calls
 * the service directly with a synthetic caller.
 */
@ApiTags('routines')
@ApiTenantAuth()
@Controller('routines')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ResolveRoutineController {
  constructor(
    @Inject(ResolveRoutineService) private readonly resolveRoutineService: ResolveRoutineService,
    private readonly familyAccess: FamilyAccessService,
  ) {}

  @Get('resolve')
  @RequirePermissions(Permission.ROUTINE_READ)
  @ApiOperation({
    summary:
      'Resolve concrete, dated slots for a section, teacher or student. A PARENT or STUDENT must use `student_id` for a student they are linked to.',
  })
  async resolve(
    @Query() query: ResolveRoutineQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    if (isGuardianRole(tenant.role)) {
      // Family callers read a routine only through their own child (Epic 21.0:
      // "the same agenda for their section"). section_id / teacher_id are staff lookups.
      if (!query.student_id || query.section_id || query.teacher_id) {
        throw new ForbiddenException('A family account can only read a routine by student_id');
      }
      await this.familyAccess.assertLinked(tenant.role, user.sub, query.student_id, tenant.id);
    }
    return this.resolveRoutineService.resolveRoutine(query, tenant.id, {
      role: tenant.role,
      userId: user.sub,
    });
  }
}
