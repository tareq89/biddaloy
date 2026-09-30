import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { StaffPerformanceService } from './staff-performance.service';
import { PerformanceQueryDto, StaffPerformanceResponseDto } from './dto/performance.dto';

/** [28.3.6] ACR_READ only, same guard stack as the ACR history route. */
@ApiTags('performance')
@ApiTenantAuth()
@Controller('performance')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class StaffPerformanceController {
  constructor(private readonly service: StaffPerformanceService) {}

  @Get('staff/:userId')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ACR_READ)
  @ApiOkResponse({ type: StaffPerformanceResponseDto })
  staff(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() q: PerformanceQueryDto,
    @CurrentTenant() t: { id: string },
    @CurrentUser() u: { sub: string },
  ) {
    return this.service.get(userId, q, t.id, u.sub);
  }
}
