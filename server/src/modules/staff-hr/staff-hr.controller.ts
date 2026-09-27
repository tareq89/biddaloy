import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { StaffHrService } from './staff-hr.service';
import {
  CreateStaffHrRecordDto,
  PromoteStaffDto,
  UpdateStaffHrRecordDto,
} from './dto/staff-hr-record.dto';

/** CRUD + promotion for `StaffHrRecord`/`StaffDesignationHistory`. 23.2.1. */
@ApiTags('staff-hr')
@ApiTenantAuth()
@Controller('staff-hr-records')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class StaffHrController {
  constructor(private readonly staffHrService: StaffHrService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.STAFF_HR_READ)
  @ApiOperation({ summary: 'List this tenant’s staff HR records, optionally filtered by user.' })
  async findAll(
    @CurrentTenant() tenant: { id: string },
    @Query('user_id', new ParseUUIDPipe({ optional: true })) userId?: string,
  ) {
    return this.staffHrService.findAll(tenant.id, userId);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.STAFF_HR_READ)
  @ApiOperation({ summary: 'Read one staff HR record.' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() tenant: { id: string }) {
    return this.staffHrService.findOne(id, tenant.id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.STAFF_HR_MANAGE)
  @ApiOperation({ summary: 'Create a staff HR record.' })
  async create(
    @Body() dto: CreateStaffHrRecordDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.staffHrService.create(dto, tenant.id, user.sub);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.STAFF_HR_MANAGE)
  @ApiOperation({ summary: 'Edit a staff HR record.' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffHrRecordDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.staffHrService.update(id, dto, tenant.id, user.sub);
  }

  @Get(':userId/current-designation')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.STAFF_HR_READ)
  @ApiOperation({ summary: "Read a staff member's current (open) designation history row." })
  async currentDesignation(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentTenant() tenant: { id: string },
  ) {
    return this.staffHrService.getCurrentDesignation(userId, tenant.id);
  }

  @Get(':userId/designation-history')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.STAFF_HR_READ)
  @ApiOperation({ summary: "List a staff member's whole designation history, newest first." })
  async designationHistory(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentTenant() tenant: { id: string },
  ) {
    return this.staffHrService.getDesignationHistory(userId, tenant.id);
  }

  @Post(':userId/promote')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.STAFF_HR_MANAGE)
  @ApiOperation({ summary: 'Promote a staff member to a new designation, effective a given date.' })
  async promote(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: PromoteStaffDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.staffHrService.promote(
      userId,
      tenant.id,
      dto.designation_id,
      dto.effective_date,
      user.sub,
      dto.notes,
    );
  }
}
