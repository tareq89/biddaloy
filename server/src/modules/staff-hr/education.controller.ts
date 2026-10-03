import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditAction, Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { AuditService } from '../audit/audit.service';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { RepeatableRowBaseService } from './dynamic-rows/repeatable-row.base.service';
import { StaffEducation } from './entities/staff-education.entity';
import { ReplaceEducationDto } from './dto/repeatable-row.dto';

/** Throws unless `userId` has a real `user_tenants` membership in
 * `tenantId` — same check as `StaffHrService.assertUserInTenant`, duplicated
 * here rather than exported since it's three lines (23.3). */
async function assertUserInTenant(
  userTenantRepo: Repository<UserTenant>,
  userId: string,
  tenantId: string,
): Promise<void> {
  const membership = await userTenantRepo.findOne({
    where: { user_id: userId, tenant_id: tenantId },
  });
  if (!membership) throw new ForbiddenException('User is not a member of this tenant');
}

@Injectable()
export class EducationRowService extends RepeatableRowBaseService<StaffEducation> {
  constructor(@InjectRepository(StaffEducation) repo: Repository<StaffEducation>) {
    super(repo);
  }
}

/** `GET`/`PUT` (full replace) for one staff member's education rows. 23.4. */
@ApiTags('staff-hr')
@ApiTenantAuth()
@Controller('staff/:userId/education')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class EducationController {
  constructor(
    private readonly rowService: EducationRowService,
    @InjectRepository(UserTenant)
    private readonly userTenantRepo: Repository<UserTenant>,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @RequirePermissions(Permission.STAFF_HR_READ)
  @ApiOperation({ summary: "List a staff member's education rows." })
  async findAll(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentTenant() tenant: { id: string },
  ) {
    return this.rowService.findRows(userId, tenant.id);
  }

  @Put()
  @RequirePermissions(Permission.STAFF_HR_MANAGE)
  @ApiOperation({ summary: "Replace a staff member's full set of education rows." })
  async replace(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ReplaceEducationDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { sub: string },
  ) {
    await assertUserInTenant(this.userTenantRepo, userId, tenant.id);
    const result = await this.rowService.replaceRows(userId, tenant.id, dto.rows, (manager) =>
      this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'StaffHrRecord',
          entity_id: userId,
          tenant_id: tenant.id,
          performed_by_user_id: user.sub,
          new_values: { education: dto.rows },
        },
        manager,
      ),
    );
    return result;
  }
}
