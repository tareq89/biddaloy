import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtPayload, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { SchoolAdminsService } from './school-admins.service';
import { AddSchoolAdminDto } from './dto/add-school-admin.dto';

/**
 * SUPER_ADMIN recovery console for a school's ADMIN access (#531): list
 * ADMIN memberships and their invitation status, add a new ADMIN (reusing
 * `ProvisioningService`'s find-or-create-user path), and resend/revoke a
 * pending invitation. ADMIN role only — no general staff-role management.
 */
@ApiTags('schools')
@ApiTenantAuth()
@Controller('schools/:id/admins')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class SchoolAdminsController {
  constructor(private readonly schoolAdmins: SchoolAdminsService) {}

  @Get()
  @ApiOperation({ summary: "List a school's ADMIN memberships and their invitation status." })
  @ApiOkResponse({ description: 'Array of ADMIN memberships.' })
  async list(@Param('id', ParseUUIDPipe) schoolId: string) {
    return this.schoolAdmins.list(schoolId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Add an ADMIN to a school, reusing the find-or-create-user + membership + invitation ' +
      'logic POST /schools uses. An existing user matched by email/phone is not duplicated.',
  })
  async addAdmin(
    @Param('id', ParseUUIDPipe) schoolId: string,
    @Body() dto: AddSchoolAdminDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.schoolAdmins.addAdmin(schoolId, dto, user.sub);
  }

  @Post(':userId/resend-invitation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Resend an ADMIN's pending invitation. Returns the reissued invitation (its `debug.token` " +
      'echoed under ACCOUNT_ACCESS_ECHO_SECRETS, same as every other issue-and-send call site) ' +
      "rather than 204 — see SchoolAdminsService.resendInvitation's own comment.",
  })
  async resendInvitation(
    @Param('id', ParseUUIDPipe) schoolId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.schoolAdmins.resendInvitation(schoolId, userId, user.sub);
  }

  @Delete(':userId/invitation')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Revoke an ADMIN's pending invitation." })
  async revokeInvitation(
    @Param('id', ParseUUIDPipe) schoolId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.schoolAdmins.revokeInvitation(schoolId, userId, user.sub);
  }
}
