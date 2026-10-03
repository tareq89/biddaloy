import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { DesignationService } from './designation.service';
import { CreateDesignationDto, UpdateDesignationDto } from './dto/designation.dto';

/** CRUD for the tenant-editable designation (job title) list. 23.2.1. */
@ApiTags('staff-hr')
@ApiTenantAuth()
@Controller('designations')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class DesignationController {
  constructor(private readonly designationService: DesignationService) {}

  @Get()
  @RequirePermissions(Permission.STAFF_HR_READ)
  @ApiOperation({ summary: 'List this tenant’s designations.' })
  async findAll(@CurrentTenant() tenant: { id: string }) {
    return this.designationService.findAll(tenant.id);
  }

  @Get(':id')
  @RequirePermissions(Permission.STAFF_HR_READ)
  @ApiOperation({ summary: 'Read one designation.' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() tenant: { id: string }) {
    return this.designationService.findOne(id, tenant.id);
  }

  @Post()
  @RequirePermissions(Permission.STAFF_HR_MANAGE)
  @ApiOperation({ summary: 'Create a designation.' })
  async create(
    @Body() dto: CreateDesignationDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.designationService.create(dto, tenant.id, user.sub);
  }

  @Patch(':id')
  @RequirePermissions(Permission.STAFF_HR_MANAGE)
  @ApiOperation({ summary: 'Edit a designation.' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDesignationDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.designationService.update(id, dto, tenant.id, user.sub);
  }

  @Delete(':id')
  @RequirePermissions(Permission.STAFF_HR_MANAGE)
  @ApiOperation({ summary: 'Soft-delete a designation.' })
  @ApiOkResponse({ description: 'Deleted' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { sub: string },
  ) {
    await this.designationService.remove(id, tenant.id, user.sub);
    return { deleted: true };
  }
}
