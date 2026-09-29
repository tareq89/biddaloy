import { createReadStream } from 'node:fs';
import {
  applyDecorators,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, UserRole } from '@biddaloy/shared';
import type { JwtPayload } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { PrintTemplatesService } from './print-templates.service';
import {
  CreatePrintTemplateDto,
  ListPrintTemplatesQueryDto,
  UpdatePrintTemplateDto,
} from './dto/print-template.dto';

type Tenant = { id: string };

// Method-level on purpose: the class has both reader and writer routes.
const read = () =>
  applyDecorators(
    Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE),
    RequirePermissions(Permission.DOCUMENT_PRINT),
  );
const write = () =>
  applyDecorators(Roles(UserRole.ADMIN), RequirePermissions(Permission.PRINT_TEMPLATE_MANAGE));

/**
 * [32.2.1] Print templates. Reads: ADMIN/ACCOUNTANT (EXECUTIVE has no
 * DOCUMENT_PRINT). Writes: ADMIN with PRINT_TEMPLATE_MANAGE. Roles and
 * permissions are per-method on purpose.
 */
@ApiTags('print-templates')
@ApiTenantAuth()
@Controller('print-templates')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class PrintTemplatesController {
  constructor(private readonly service: PrintTemplatesService) {}

  @Get()
  @read()
  @ApiOperation({ summary: 'List print templates.' })
  list(@Query() q: ListPrintTemplatesQueryDto, @CurrentTenant() tenant: Tenant) {
    return this.service.list(tenant.id, q);
  }

  @Get('suggestions')
  @read()
  @ApiOperation({ summary: 'List the built-in template suggestions.' })
  suggestions() {
    return this.service.suggestions();
  }

  @Get('suggestions/:key/artwork/:side')
  @read()
  @ApiOperation({ summary: 'Stream a suggestion background as SVG.' })
  artwork(@Param('key') key: string, @Param('side') side: string) {
    const path = this.service.suggestionArtworkPath(key, side);
    return new StreamableFile(createReadStream(path), { type: 'image/svg+xml' });
  }

  @Get('versions/:versionId')
  @read()
  @ApiOperation({ summary: 'One published version, with its definition.' })
  version(@Param('versionId', ParseUUIDPipe) versionId: string, @CurrentTenant() tenant: Tenant) {
    return this.service.findVersion(tenant.id, versionId);
  }

  @Post()
  @write()
  @ApiOperation({ summary: 'Create a draft template from a suggestion.' })
  create(
    @Body() dto: CreatePrintTemplateDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.create(tenant.id, user.sub, dto);
  }

  @Get(':id')
  @read()
  @ApiOperation({ summary: 'Template draft plus the current version.' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() tenant: Tenant) {
    return this.service.findOne(tenant.id, id);
  }

  @Patch(':id')
  @write()
  @ApiOperation({ summary: 'Edit name, batch size or draft.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePrintTemplateDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.update(tenant.id, user.sub, id, dto);
  }

  @Post(':id/publish')
  @write()
  @HttpCode(200)
  @ApiOperation({ summary: 'Publish the draft as a new immutable version.' })
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.publish(tenant.id, user.sub, id);
  }

  @Post(':id/default')
  @write()
  @HttpCode(200)
  @ApiOperation({ summary: 'Make this the default for its document kind.' })
  setDefault(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.setDefault(tenant.id, user.sub, id);
  }

  @Post(':id/archive')
  @write()
  @HttpCode(200)
  @ApiOperation({ summary: 'Archive a template.' })
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.archive(tenant.id, user.sub, id);
  }

  @Get(':id/versions')
  @read()
  @ApiOperation({ summary: 'Published versions of a template.' })
  versions(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() tenant: Tenant) {
    return this.service.listVersions(tenant.id, id);
  }
}
