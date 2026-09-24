import { Body, Controller, Inject, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { HomeworkBulkUploadService } from './homework-bulk-upload.service';
import { CommitHomeworkBulkUploadDto } from './dto/homework-bulk-upload.dto';
import { UserRole, JwtPayload, Permission } from '@biddaloy/shared';

const BULK_UPLOAD_MAX_FILE_SIZE = 5 * 1024 * 1024;

/** [22.3.3] CSV/Excel bulk homework import — validate/commit split, same
 * pattern as students/bulk-upload (StudentBulkUploadService). */
@ApiTags('homework')
@ApiTenantAuth()
@Controller('homework/bulk')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class HomeworkBulkUploadController {
  constructor(
    @Inject(HomeworkBulkUploadService) private readonly bulkUploadService: HomeworkBulkUploadService,
  ) {}

  @Post('validate')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @RequirePermissions(Permission.HOMEWORK_IMPORT)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: BULK_UPLOAD_MAX_FILE_SIZE } }))
  @ApiOperation({
    summary:
      'Validate a CSV/XLSX spreadsheet of homework rows (max 5MB) and stage the accepted rows. Writes nothing.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  validate(
    @UploadedFile() file: Express.Multer.File,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bulkUploadService.validate(file, tenant.id, user.sub);
  }

  @Post('commit')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @RequirePermissions(Permission.HOMEWORK_IMPORT)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary:
      'Commit a previously validated, staged bulk upload — creates one Homework + one HomeworkAssignment per row.',
  })
  commit(
    @Body() dto: CommitHomeworkBulkUploadDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bulkUploadService.commit(dto.staging_id, tenant.id, user.sub);
  }
}
