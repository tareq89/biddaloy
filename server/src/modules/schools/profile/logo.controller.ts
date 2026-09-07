import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { JwtPayload, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../../common/request-context.util';
import { assertCanReadSchoolLogo } from './assert-can-read-school-logo.util';
import { SchoolLogoService } from './logo.service';

const LOGO_MAX_FILE_SIZE = 512 * 1024;

/**
 * [15.5.3]/[15.5.4] Logo upload/removal and serving.
 *
 * `POST`/`DELETE /schools/me/logo` are ADMIN-only, same as the rest of the
 * profile ([15.5.2]) — always the caller's own tenant.
 *
 * `GET /schools/:id/logo` is deliberately *not* under `me`: it's the URL
 * the browser's `<img src>` actually requests, addressed by the `:id` a
 * print view or Settings page already has in hand, open to any staff role
 * that's a member of that school (or SUPER_ADMIN) — see
 * `assertCanReadSchoolLogo`. Never exposes the storage key or bucket.
 */
@ApiTags('schools')
@ApiTenantAuth()
@Controller('schools')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
export class SchoolLogoController {
  constructor(private readonly logo: SchoolLogoService) {}

  @Get(':id/logo')
  @ApiOperation({
    summary:
      'Serve the raw logo bytes for a school. Any member of that school (or SUPER_ADMIN). 404 if the school has no logo.',
  })
  @Header('Cache-Control', 'private, max-age=31536000, immutable')
  async serve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    assertCanReadSchoolLogo(tenant, id);
    const { stream, contentType } = await this.logo.serve(id);
    res.setHeader('Content-Type', contentType);
    return new StreamableFile(stream);
  }

  @Post('me/logo')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LOGO_MAX_FILE_SIZE } }))
  @ApiOperation({
    summary:
      'Upload the school logo (PNG/JPEG/WebP, <=512KB, <=2048px per side). Re-encoded to a 512x512-max PNG.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOkResponse()
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('A "file" field with the image is required');
    }
    return this.logo.upload(tenant.id, file.buffer, user.sub, requestContext(request));
  }

  @Delete('me/logo')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove the school logo.' })
  async remove(
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    await this.logo.remove(tenant.id, user.sub, requestContext(request));
  }
}
