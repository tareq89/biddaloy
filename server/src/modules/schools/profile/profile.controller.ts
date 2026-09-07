import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtPayload, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../../common/request-context.util';
import { SchoolProfileService } from './profile.service';
import { UpdateSchoolProfileDto } from './dto/update-school-profile.dto';

/**
 * [15.5.2] `/schools/me/profile` — the ADMIN-editable identity fields for
 * the caller's own tenant. Always resolved from `req.currentTenant`, never
 * a `:id` param — there's no cross-tenant read/write surface here at all.
 */
@ApiTags('schools')
@ApiTenantAuth()
@Controller('schools/me/profile')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class SchoolProfileController {
  constructor(private readonly profile: SchoolProfileService) {}

  @Get()
  @ApiOperation({
    summary:
      "Read the caller's school profile (name, name_bn, address, phone, email, registration_id, logo_url). Any authenticated staff role.",
  })
  @ApiOkResponse()
  async getProfile(@CurrentTenant() tenant: { id: string; role: string }) {
    return this.profile.getProfile(tenant.id);
  }

  @Patch()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Update the caller school profile (partial). ADMIN only. Every change is audited.',
  })
  @ApiOkResponse()
  @ApiForbiddenResponse({ description: 'Only ADMIN (or SUPER_ADMIN) may edit the school profile.' })
  async updateProfile(
    @Body() dto: UpdateSchoolProfileDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.profile.updateProfile(tenant.id, dto, user.sub, requestContext(request));
  }
}
