import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { PRINT_ASSET_UPLOAD_LIMIT, PrintAssetsService } from './print-assets.service';

/** [32.2.2] D55 — print asset endpoints. Guard chain as the other
 * permission-gated controllers. */
@ApiTags('print')
@ApiTenantAuth()
@Controller('print-assets')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class PrintAssetsController {
  constructor(private readonly assets: PrintAssetsService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.PRINT_TEMPLATE_MANAGE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PRINT_ASSET_UPLOAD_LIMIT } }))
  @ApiOperation({ summary: 'Upload artwork, an image or a font. Validated by content.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['kind', 'file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        kind: { type: 'string', enum: ['ARTWORK', 'IMAGE', 'FONT'] },
        font_family: { type: 'string' },
      },
    },
  })
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { kind?: string; font_family?: string },
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.assets.upload(
      tenant.id,
      user.sub,
      String(body?.kind ?? ''),
      file,
      body?.font_family,
    );
  }

  // Reads: any role holding DOCUMENT_PRINT (ADMIN, ACCOUNTANT/front office).
  @Get()
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.DOCUMENT_PRINT)
  @ApiOperation({ summary: 'List non-archived print assets, optionally by kind.' })
  @ApiQuery({ name: 'kind', required: false, enum: ['ARTWORK', 'IMAGE', 'FONT'] })
  list(@CurrentTenant() tenant: { id: string }, @Query('kind') kind?: string) {
    return this.assets.list(tenant.id, kind);
  }

  @Get(':id/file')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.DOCUMENT_PRINT)
  // Keys are UUIDs and never reused, so the bytes behind an id never change.
  @Header('Cache-Control', 'private, max-age=31536000, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  // Uploaded SVG opened directly must not run or load anything.
  @Header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  @ApiOperation({ summary: 'Stream the asset bytes. Tenant-scoped — 404 across tenants.' })
  async file(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { asset, object } = await this.assets.getFile(id, tenant.id);
    res.setHeader('Content-Type', asset.content_type);
    return new StreamableFile(object.body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.PRINT_TEMPLATE_MANAGE)
  @ApiOperation({ summary: 'Archive an asset (hides it from lists; the object is kept).' })
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.assets.archive(id, tenant.id, user.sub);
  }
}
