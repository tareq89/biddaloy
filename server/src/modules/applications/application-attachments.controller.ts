import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ATTACHMENT_LIMITS, Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { buildContentDisposition } from '../staff-hr/staff-document.controller';
import { ApplicationAttachmentsService } from './application-attachments.service';
import { ApplicationAttachmentDto } from './dto/application.dto';

type Tenant = { id: string; role: UserRole };
type Actor = { sub: string };

@ApiTags('applications')
@ApiTenantAuth()
@Controller('applications')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.APPLICATION_SUBMIT)
export class ApplicationAttachmentsController {
  constructor(private readonly service: ApplicationAttachmentsService) {}

  @Post(':id/attachments')
  @UseInterceptors(
    FilesInterceptor('files', ATTACHMENT_LIMITS.maxFiles, {
      limits: { fileSize: ATTACHMENT_LIMITS.maxBytes },
    }),
  )
  @ApiOperation({
    summary: 'Attach up to 3 files (PDF, JPG, PNG; 5 MB each) to a pending application',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } },
    },
  })
  @ApiCreatedResponse({ type: [ApplicationAttachmentDto] })
  upload(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: Actor,
  ): Promise<ApplicationAttachmentDto[]> {
    return this.service.upload(tenant.id, { userId: user.sub, role: tenant.role }, id, files);
  }

  @Get(':id/attachments/:attachmentId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Download one attachment (anyone who can view the application)' })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: Actor,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { file, object } = await this.service.open(
      tenant.id,
      { userId: user.sub, role: tenant.role },
      id,
      attachmentId,
    );
    res.setHeader('Content-Type', object.contentType ?? file.mime_type);
    res.setHeader('Content-Disposition', buildContentDisposition(file.file_name));
    return new StreamableFile(object.body);
  }

  @Delete(':id/attachments/:attachmentId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove an attachment from a pending application' })
  @ApiNoContentResponse()
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: Actor,
  ): Promise<void> {
    return this.service.remove(
      tenant.id,
      { userId: user.sub, role: tenant.role },
      id,
      attachmentId,
    );
  }
}
