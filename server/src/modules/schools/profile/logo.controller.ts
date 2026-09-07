import {
  BadRequestException,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtPayload, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../../common/request-context.util';
import { SchoolLogoService } from './logo.service';

const LOGO_MAX_FILE_SIZE = 512 * 1024;

/**
 * [15.5.3] `/schools/me/logo` — upload/remove the caller school's logo.
 * ADMIN only, same as the rest of the profile ([15.5.2]). The GET that
 * serves the actual bytes lives on `SchoolsController` ([15.5.4]) since
 * it's tenant-scoped by `:id`, not `me`.
 */
@ApiTags('schools')
@ApiTenantAuth()
@Controller('schools/me/logo')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class SchoolLogoController {
  constructor(private readonly logo: SchoolLogoService) {}

  @Post()
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

  @Delete()
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
