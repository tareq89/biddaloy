import {
  Body,
  Controller,
  Post,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { ApiBody, ApiConsumes, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ModuleKey, Permission } from '@biddaloy/shared';
import type { JwtPayload } from '@biddaloy/shared';
import { requestContext } from '../../common/request-context.util';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { RequiresModule } from '../auth/decorators/require-module.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AdmissionApplicantService } from './admission-applicant.service';
import { MAX_DOCUMENT_FILE_SIZE } from './admission-upload.constants';
import { StaffCreateApplicantDto } from './dto/staff-create-applicant.dto';
import { SubmitApplicantResponseDto } from './dto/submit-applicant.dto';

/** [71.G1.02] A clerk enters an application for a walk-in guardian. */
@ApiTags('admission')
@ApiTenantAuth()
@Controller('admission/applicants')
@RequiresModule(ModuleKey.admission)
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.ADMISSION_REVIEW)
export class AdmissionApplicantStaffController {
  constructor(private readonly applicants: AdmissionApplicantService) {}

  @Post()
  @UseInterceptors(
    AnyFilesInterceptor({ limits: { fileSize: MAX_DOCUMENT_FILE_SIZE, files: 4 } }),
    IdempotencyInterceptor,
  )
  @ApiOperation({
    summary:
      'Create an application for a walk-in guardian (no captcha). Multipart: applicant fields, ' +
      'document files by type, and for a fee round fee_method plus one fee_proof file ' +
      '(fee_reference optional). A repeated fee reference is a warning, not an error. ' +
      'allow_after_close lets a late walk-in past the close date.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: StaffCreateApplicantDto })
  @ApiCreatedResponse({ type: SubmitApplicantResponseDto })
  create(
    @Body() dto: StaffCreateApplicantDto,
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const ctx = requestContext(request);
    return this.applicants.createByStaff(tenant.id, dto, files ?? [], {
      userId: user.sub,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }
}
