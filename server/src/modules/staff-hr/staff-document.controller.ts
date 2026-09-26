import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Permission, StaffDocumentType, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { STAFF_DOCUMENT_MAX_FILE_SIZE, StaffDocumentService } from './staff-document.service';

/** Throws unless `userId` has a real `user_tenants` membership in
 * `tenantId` — same check as `FamilyController`'s (23.3), duplicated here
 * rather than shared since it's three lines. */
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

/**
 * Builds a safe `Content-Disposition` header value from a user-supplied
 * filename: an ASCII-only fallback (any non-ASCII/control char becomes `_`,
 * which also removes CR/LF/`"` injection risk) plus an RFC 5987 `filename*`
 * so browsers still show the real UTF-8 name (e.g. a Bangla original
 * filename) instead of the fallback.
 */
function buildContentDisposition(originalFilename: string): string {
  // eslint-disable-next-line no-control-regex
  const asciiFallback = originalFilename.replace(/[^\x20-\x7e]|["\\]/g, '_') || 'document';
  const encoded = encodeURIComponent(originalFilename);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

/** Upload/list/download for `StaffDocument` (23.6). Same guard chain as
 * `StaffHrController`. */
@ApiTags('staff-hr')
@ApiTenantAuth()
@Controller('staff-documents')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class StaffDocumentController {
  constructor(
    private readonly documents: StaffDocumentService,
    @InjectRepository(UserTenant)
    private readonly userTenantRepo: Repository<UserTenant>,
  ) {}

  @Post(':staffUserId/:documentType')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.STAFF_HR_MANAGE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: STAFF_DOCUMENT_MAX_FILE_SIZE } }))
  @ApiOperation({ summary: 'Upload (or replace) one staff document.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  async upload(
    @Param('staffUserId', ParseUUIDPipe) staffUserId: string,
    @Param('documentType') documentType: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { sub: string },
  ) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }
    if (!Object.values(StaffDocumentType).includes(documentType as StaffDocumentType)) {
      throw new BadRequestException('Invalid document_type');
    }
    await assertUserInTenant(this.userTenantRepo, staffUserId, tenant.id);
    return this.documents.upload(staffUserId, documentType as StaffDocumentType, file, {
      userId: user.sub,
      tenantId: tenant.id,
    });
  }

  @Get(':staffUserId')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.STAFF_HR_READ)
  @ApiOperation({ summary: "List a staff member's uploaded documents." })
  async findAll(
    @Param('staffUserId', ParseUUIDPipe) staffUserId: string,
    @CurrentTenant() tenant: { id: string },
  ) {
    return this.documents.findAllForStaff(staffUserId, tenant.id);
  }

  @Get('download/:id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.STAFF_HR_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Download one staff document. Tenant-scoped — 404 across tenants.' })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { doc, object } = await this.documents.download(id, tenant.id);
    res.setHeader('Content-Type', object.contentType ?? doc.content_type);
    res.setHeader('Content-Disposition', buildContentDisposition(doc.original_filename));
    return new StreamableFile(object.body);
  }
}
