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
import { PerformanceService } from './performance.service';
import {
  ClassPerformanceQueryDto,
  ClassPerformanceResponseDto,
  PerformanceQueryDto,
  StudentPerformanceResponseDto,
} from './dto/performance.dto';

/** [28.3.5] Read-only student/class performance; same gate as Analysis. */
@ApiTags('performance')
@ApiTenantAuth()
@Controller('performance')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class PerformanceController {
  constructor(private readonly service: PerformanceService) {}

  @Get('students/:studentId')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.TEACHER)
  @RequirePermissions(Permission.MARK_VIEW)
  @ApiOkResponse({ type: StudentPerformanceResponseDto })
  student(
    @Param('studentId', ParseUUIDPipe) id: string,
    @Query() q: PerformanceQueryDto,
    @CurrentTenant() t: { id: string; role: string },
    @CurrentUser() u: { sub: string },
  ) {
    return this.service.getStudentPerformance(id, q, {
      tenantId: t.id,
      role: t.role,
      userId: u.sub,
    });
  }

  @Get('classes/:classId')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.TEACHER)
  @RequirePermissions(Permission.MARK_VIEW)
  @ApiOkResponse({ type: ClassPerformanceResponseDto })
  klass(
    @Param('classId', ParseUUIDPipe) id: string,
    @Query() q: ClassPerformanceQueryDto,
    @CurrentTenant() t: { id: string; role: string },
    @CurrentUser() u: { sub: string },
  ) {
    return this.service.getClassPerformance(id, q, {
      tenantId: t.id,
      role: t.role,
      userId: u.sub,
    });
  }
}
