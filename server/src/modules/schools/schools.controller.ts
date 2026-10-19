import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtPayload, Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PlatformSuperAdminGuard } from '../auth/guards/platform-super-admin.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { SETTINGS_RATE_LIMIT } from '../../rate-limit';
import { requestContext } from '../../common/request-context.util';
import { TrialService } from './trial/trial.service';
import { SchoolsService } from './schools.service';
import { TenantSettingsDto } from './dto/tenant-settings.dto';
import { assertCanManageSchool } from './assert-can-manage-school.util';
import { ExtendTrialDto } from './dto/extend-trial.dto';
import { ListSchoolsQueryDto, SchoolListItemDto } from './dto/school-list-item.dto';
import { TenantSettingsResponseDto } from './dto/school-settings-response.dto';
import { UpdateSchoolStatusDto } from './dto/update-school-status.dto';
import { AuthenticatedOnly } from '../auth/decorators/authenticated-only.decorator';

@ApiTags('schools')
@ApiTenantAuth()
@Controller('schools')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class SchoolsController {
  constructor(
    private readonly schools: SchoolsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  @AuthenticatedOnly()
  @Get()
  @Roles(UserRole.SUPER_ADMIN)
  @UseGuards(PlatformSuperAdminGuard)
  @ApiOperation({
    summary:
      "List every school (id, name, slug, status, created_at) — #8.7.13's super-admin school picker, extended by #533's platform schools list. An ADMIN doesn't get this route at all; they already know their one school from their own tenant context.",
  })
  @ApiOkResponse({ type: SchoolListItemDto, isArray: true })
  async findAll(@Query() query: ListSchoolsQueryDto) {
    return this.schools.findAll(query.trial);
  }

  @AuthenticatedOnly()
  @Get(':id/stats')
  @Roles(UserRole.SUPER_ADMIN)
  @UseGuards(PlatformSuperAdminGuard)
  @ApiOperation({
    summary:
      'Five cheap platform metrics for a school (#532) — active users, students, queued/recently-failed communications, and last activity. SUPER_ADMIN only.',
  })
  async getStats(@Param('id', ParseUUIDPipe) id: string) {
    return this.schools.getStats(id);
  }

  @AuthenticatedOnly()
  @Patch(':id/status')
  @Roles(UserRole.SUPER_ADMIN)
  @UseGuards(PlatformSuperAdminGuard)
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

  @AuthenticatedOnly()
  @Patch(':id/trial')
  @Roles(UserRole.SUPER_ADMIN)
  @UseGuards(PlatformSuperAdminGuard)
  @ApiOperation({
    summary:
      'Grant a school `seat_limit` seats for `days` (rounded up to months) as a paid-for-free order (Epic 49; was the trial extension). Platform SUPER_ADMIN only. Audited with the reason.',
  })
  async extendTrial(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExtendTrialDto,
    @CurrentUser() user: JwtPayload,
  ) {
    // Looked up lazily: TrialModule -> CommunicationsModule -> SchoolsModule is a file-level import
    // cycle, so SchoolsModule can't import TrialModule. TrialModule is registered in AppModule.
    const trial = this.moduleRef.get(TrialService, { strict: false });
    // The trial is retired (Epic 49): `seat_limit` seats are granted for `days` rounded up to whole months.
    if (!dto.seat_limit) {
      throw new BadRequestException({
        message: 'seat_limit is required to grant seats',
        details: { code: 'SEATS_REQUIRED' },
      });
    }
    return trial.grantSeats(
      id,
      { seats: dto.seat_limit, months: Math.min(24, Math.ceil(dto.days / 30)), reason: dto.reason },
      { userId: user.sub },
    );
  }

  @Get(':id/settings')
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
