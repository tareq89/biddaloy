import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtPayload, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import { requestContext } from '../../common/request-context.util';
import { SchoolsService } from './schools.service';
import { TenantSettingsDto } from './dto/tenant-settings.dto';

/**
 * A super admin configures *any* school; an admin configures only their
 * own. Both roles hold `SETTINGS_MANAGE` (see `shared/enums/permissions`),
 * so the permission alone doesn't express the difference — this is that
 * check, enforced server-side rather than by hiding a nav item.
 *
 * Deliberately a 403, not the codebase's usual cross-tenant 404
 * (`cross-tenant-access.e2e-spec.ts`'s convention for a resource scoped
 * *by* tenant, like a student or invoice): `:id` here doesn't belong to a
 * tenant, it *is* one, so "wrong tenant" is an authorization decision
 * about the caller, not a lookup that came up empty. Checked before any
 * DB read, so a rejected request never depends on whether `:id` happens
 * to be a real school.
 */
function assertCanManageSchool(tenant: { id: string; role: string }, schoolId: string): void {
  if (tenant.role === UserRole.SUPER_ADMIN) return;
  if (tenant.id === schoolId) return;
  throw new ForbiddenException(`Not permitted to manage settings for school "${schoolId}".`);
}

@ApiTags('schools')
@ApiTenantAuth()
@Controller('schools')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
export class SchoolsController {
  constructor(private readonly schools: SchoolsService) {}

  @Get(':id/settings')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  // Credential-bearing read: every secret's masked hint is still
  // information about that school's provider accounts, worth the
  // stricter tier the write side gets too.
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary:
      "Read a school's tenant settings. Secret fields (WhatsApp/email/SMS credentials) are masked — configured flag and a short hint, never the plaintext.",
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
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary:
      "Update a school's tenant settings. A secret field omitted from the body is left unchanged; sending it as null clears it. Unknown keys are rejected.",
  })
  async updateSettings(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TenantSettingsDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    assertCanManageSchool(tenant, id);
    await this.schools.updateSettings(id, dto, user.sub, requestContext(request));
    return this.schools.getMaskedSettings(id);
  }
}
