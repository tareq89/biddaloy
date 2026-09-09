import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtPayload, Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { SETTINGS_RATE_LIMIT } from '../../rate-limit';
import { requestContext } from '../../common/request-context.util';
import { SchoolsService } from './schools.service';
import { TenantSettingsDto } from './dto/tenant-settings.dto';
import { assertCanManageSchool } from './assert-can-manage-school.util';
import { SchoolListItemDto } from './dto/school-list-item.dto';
import { TenantSettingsResponseDto } from './dto/school-settings-response.dto';
import { UpdateSchoolStatusDto } from './dto/update-school-status.dto';

@ApiTags('schools')
@ApiTenantAuth()
@Controller('schools')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class SchoolsController {
  constructor(private readonly schools: SchoolsService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary:
      "List every school (id, name, slug, status, created_at) — #8.7.13's super-admin school picker, extended by #533's platform schools list. An ADMIN doesn't get this route at all; they already know their one school from their own tenant context.",
  })
  @ApiOkResponse({ type: SchoolListItemDto, isArray: true })
  async findAll() {
    return this.schools.findAll();
  }

  @Get(':id/stats')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'Five cheap platform metrics for a school (#532) — active users, students, queued/recently-failed communications, and last activity. SUPER_ADMIN only.',
  })
  async getStats(@Param('id', ParseUUIDPipe) id: string) {
    return this.schools.getStats(id);
  }

  @Patch(':id/status')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary:
      "Suspend or reactivate a school (#530). SUPER_ADMIN only. A mandatory reason is audited (SUSPEND/REACTIVATE), and the tenant status cache is invalidated so the change takes effect on the school's very next request.",
  })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSchoolStatusDto,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.schools.updateStatus(id, dto, user.sub, requestContext(request));
  }

  @Get(':id/settings')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  // Credential-bearing read: every secret's masked hint is still
  // information about that school's provider accounts, worth a stricter
  // tier than the global default — see SETTINGS_RATE_LIMIT's own comment
  // for why not STRICT_RATE_LIMIT.
  @Throttle({ default: SETTINGS_RATE_LIMIT })
  @ApiOperation({
    summary:
      "Read a school's tenant settings. Secret fields (WhatsApp/email/SMS credentials) are masked — configured flag and a short hint, never the plaintext.",
  })
  @ApiOkResponse({ type: TenantSettingsResponseDto })
  @ApiForbiddenResponse({
    description:
      'An ADMIN attempted to manage a school other than their own; only a SUPER_ADMIN can manage any school.',
  })
  async getSettings(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    assertCanManageSchool(tenant, id);
    return this.schools.getMaskedSettings(id);
  }

  @Patch(':id/settings')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @Throttle({ default: SETTINGS_RATE_LIMIT })
  @ApiOperation({
    summary:
      "Update a school's tenant settings. A secret field omitted from the body is left unchanged; sending it as null clears it. Unknown keys are rejected.",
  })
  @ApiOkResponse({ type: TenantSettingsResponseDto })
  @ApiForbiddenResponse({
    description:
      'An ADMIN attempted to manage a school other than their own; only a SUPER_ADMIN can manage any school.',
  })
  async updateSettings(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TenantSettingsDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    assertCanManageSchool(tenant, id);
    return this.schools.updateSettings(id, dto, user.sub, requestContext(request));
  }
}
