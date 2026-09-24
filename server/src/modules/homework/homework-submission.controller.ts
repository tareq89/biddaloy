import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import {
  HOMEWORK_SUBMISSION_MAX_FILES,
  HOMEWORK_SUBMISSION_MAX_FILE_SIZE,
  HomeworkSubmissionService,
} from './homework-submission.service';
import {
  CreateHomeworkSubmissionDto,
  HomeworkSubmissionResponseDto,
  UpdateHomeworkSubmissionDto,
} from './dto/homework-submission.dto';

/**
 * `@Roles(...)` is the coarse gate. Object-level scoping is
 * `FamilyAccessService` (D26, upload — a STUDENT/PARENT only for their own
 * child) or `HomeworkAccessService` (PATCH/GET, teacher section/subject
 * scoping) — both inside `HomeworkSubmissionService`.
 */
@ApiTags('homework')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class HomeworkSubmissionController {
  constructor(private readonly submissionService: HomeworkSubmissionService) {}

  @Post('homework-assignments/:id/submissions')
  @Roles(UserRole.STUDENT, UserRole.PARENT)
  @RequirePermissions(Permission.HOMEWORK_READ)
  @UseInterceptors(
    FilesInterceptor('files', HOMEWORK_SUBMISSION_MAX_FILES, {
      limits: { fileSize: HOMEWORK_SUBMISSION_MAX_FILE_SIZE },
    }),
  )
  @ApiOperation({
    summary:
      'Upload (or resubmit) a homework submission — up to 10 files, 5MB each, PDF/JPG/PNG/WebP (D27). Blocked once due_date has passed.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        student_id: { type: 'string', format: 'uuid' },
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  @ApiOkResponse({ type: HomeworkSubmissionResponseDto })
  async upload(
    @Param('id') id: string,
    @Body() dto: CreateHomeworkSubmissionDto,
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    if (!files?.length) {
      throw new BadRequestException('At least one file is required');
    }
    return this.submissionService.upload(id, dto.student_id, files, {
      role: tenant.role,
      userId: user.sub,
      tenantId: tenant.id,
    });
  }

  @Patch('homework-submissions/:id')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @RequirePermissions(Permission.HOMEWORK_GRADE)
  @ApiOperation({ summary: 'Teacher grade/tick/override of a submission (D9).' })
  @ApiOkResponse({ type: HomeworkSubmissionResponseDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateHomeworkSubmissionDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.submissionService.update(id, dto, {
      role: tenant.role,
      userId: user.sub,
      tenantId: tenant.id,
    });
  }

  @Get('homework-assignments/:id/submissions')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @RequirePermissions(Permission.HOMEWORK_READ)
  @ApiOperation({ summary: 'List submissions for an assignment (teacher grid view).' })
  @ApiOkResponse({ type: HomeworkSubmissionResponseDto, isArray: true })
  async findAll(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.submissionService.findAllForAssignment(id, {
      role: tenant.role,
      userId: user.sub,
      tenantId: tenant.id,
    });
  }
}
