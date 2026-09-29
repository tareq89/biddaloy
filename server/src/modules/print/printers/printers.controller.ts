import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtPayload, Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { PrintersService } from './printers.service';
import { CreatePrinterProfileDto, UpdatePrinterProfileDto } from './dto/printer-profile.dto';

/** [32.2.x] Printer profiles (D55). Read: DOCUMENT_PRINT; write: PRINT_TEMPLATE_MANAGE. */
@ApiTags('printers')
@ApiTenantAuth()
@Controller('printers')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class PrintersController {
  constructor(private readonly printers: PrintersService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.DOCUMENT_PRINT)
  @ApiOperation({ summary: 'List non-archived printer profiles, sorted by name.' })
  list(@CurrentTenant() tenant: { id: string }) {
    return this.printers.list(tenant.id);
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @RequirePermissions(Permission.PRINT_TEMPLATE_MANAGE)
  @ApiOperation({ summary: 'Create a printer profile (margins default by type).' })
  create(
    @Body() dto: CreatePrinterProfileDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.printers.create(tenant.id, user.sub, dto);
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @RequirePermissions(Permission.PRINT_TEMPLATE_MANAGE)
  @ApiOperation({ summary: 'Update a printer profile.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePrinterProfileDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.printers.update(tenant.id, user.sub, id, dto);
  }

  @Post(':id/archive')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @RequirePermissions(Permission.PRINT_TEMPLATE_MANAGE)
  @ApiOperation({ summary: 'Archive a printer profile (hides it from the list).' })
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.printers.archive(tenant.id, user.sub, id);
  }
}
