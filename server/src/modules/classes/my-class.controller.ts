import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { TeacherScopeService } from './teacher-scope.service';
import { MyClassSectionDto } from './dto/my-class.dto';

@ApiTags('my-class')
@ApiTenantAuth()
@Controller('my-class')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class MyClassController {
  constructor(private readonly teacherScope: TeacherScopeService) {}

  @Get('sections')
  @RequirePermissions(Permission.MY_CLASS_VIEW)
  @ApiOperation({
    summary: "The caller's class-teacher / assistant sections in the current academic year.",
  })
  @ApiOkResponse({ type: MyClassSectionDto, isArray: true })
  listSections(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { sub: string },
  ): Promise<MyClassSectionDto[]> {
    return this.teacherScope.homeroomSections({ userId: user.sub, tenantId: tenant.id });
  }
}
