import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtPayload, Permission, UserRole } from '@biddaloy/shared';
import { STRICT_RATE_LIMIT } from '../../../rate-limit';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RestoreService } from './restore.service';
import { RequestRestoreDto, RequestRestoreResponseDto } from './dto/restore.dto';

/**
 * [14.10.3] HTTP entry point for restore. All the guards this needs
 * (staging exists and is error-free, confirmation phrase matches, no other
 * restore running) already live in `RestoreService.request` and throw
 * `NotFoundException` / `BadRequestException` / `ConflictException` — this
 * controller only translates the call, it adds no logic of its own.
 */
@ApiTags('backup')
@ApiTenantAuth()
@Controller('backup')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@RequirePermissions(Permission.BACKUP_MANAGE)
export class RestoreController {
  constructor(private readonly restore: RestoreService) {}

  @Post('restore')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permission.BACKUP_MANAGE)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary:
      'Queue a restore from a staged, validated workbook. Returns immediately with the restore job id and the pre-restore snapshot job id; poll GET /backup/jobs/:id for progress.',
  })
  @ApiResponse({ status: 202, type: RequestRestoreResponseDto })
  async requestRestore(
    @Body() dto: RequestRestoreDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ): Promise<RequestRestoreResponseDto> {
    const { job, snapshotJob } = await this.restore.request(tenant.id, user.sub, {
      staging_id: dto.staging_id,
      confirmation: dto.confirmation,
      invite_users: dto.invite_users,
    });
    return { job_id: job.id, snapshot_job_id: snapshotJob.id };
  }
}
