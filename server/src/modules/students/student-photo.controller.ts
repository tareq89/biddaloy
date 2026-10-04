import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { requestContext } from '../../common/request-context.util';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { JwtPayload, Permission } from '@biddaloy/shared';
import { FamilyAccessService } from './family-access.service';
import { STUDENT_PHOTO_MAX_BYTES, StudentPhotoService } from './student-photo.service';

@ApiTags('students')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class StudentPhotoController {
  constructor(
    private readonly photos: StudentPhotoService,
    private readonly familyAccess: FamilyAccessService,
  ) {}

  // There is no `POST students/:id`, so this static path cannot collide with
  // `POST students/:id/photo`.
  @Post('students/photos/bulk')
  @RequirePermissions(Permission.STUDENT_UPDATE)
  @UseInterceptors(
    FilesInterceptor('files', 25, { limits: { fileSize: STUDENT_PHOTO_MAX_BYTES * 2, files: 25 } }),
  )
  @ApiOperation({
    summary:
      'Bulk photo upload (max 25 per request). File name without extension must equal the student registration number.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } },
    },
  })
  @ApiOkResponse()
  bulk(
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    if (!files?.length) throw new BadRequestException('At least one "files" entry is required');
    return this.photos.bulkUpload(files, tenant.id, user.sub, requestContext(request));
  }

  @Post('students/:id/photo')
  @RequirePermissions(Permission.STUDENT_UPDATE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: STUDENT_PHOTO_MAX_BYTES } }))
  @ApiOperation({ summary: 'Upload a student photo (PNG/JPEG/WebP). Re-encoded to JPEG.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOkResponse()
  upload(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    if (!file?.buffer) throw new BadRequestException('A "file" field with the image is required');
    return this.photos.upload(id, file.buffer, tenant.id, user.sub, requestContext(request));
  }

  @Get('students/:id/photo')
  // Same permission + linkage check as `GET students/:id`.
  @RequirePermissions(Permission.STUDENT_READ)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: "Stream a student's photo. PARENT/STUDENT must be linked to the student.",
  })
  async serve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.familyAccess.assertLinked(tenant.role, user.sub, id, tenant.id);
    const { stream, contentType } = await this.photos.serve(id, tenant.id);
    res.setHeader('Content-Type', contentType);
    return new StreamableFile(stream);
  }
}
