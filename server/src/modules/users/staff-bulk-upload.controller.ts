import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import { JwtPayload, Permission } from '@biddaloy/shared';
import { StaffBulkUploadService } from './staff-bulk-upload.service';
import { StaffImportCommitDto } from './dto/staff-bulk-upload.dto';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // same as students

@ApiTags('users')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class StaffBulkUploadController {
  constructor(private readonly service: StaffBulkUploadService) {}

  @Post('users/bulk-upload/validate')
  @RequirePermissions(Permission.USER_CREATE)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  @ApiOperation({
    summary:
      'Validate a CSV/XLSX of teachers and staff (max 5MB) and stage the accepted rows. Writes nothing.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  validate(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.service.validate(file, tenant.id, user.sub);
  }

  @Post('users/bulk-upload/commit')
  @RequirePermissions(Permission.USER_CREATE)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary: 'Commit a validated staff import: creates or restores members, optionally invites.',
  })
  commit(
    @Body() dto: StaffImportCommitDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.commit(dto, tenant.id, user.sub);
  }
}
