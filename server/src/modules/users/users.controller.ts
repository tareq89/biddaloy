import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import type { Request } from 'express';
import { UserService, TeacherService } from './users.service';
import { RecoveryService } from '../account-access/recovery.service';
import { requestContext } from '../../common/request-context.util';
import {
  CreateUserDto,
  UpdateUserDto,
  UpdateOwnProfileDto,
  QueryUserDto,
  CreateTeacherDto,
  UpdateTeacherDto,
  QueryTeacherDto,
} from './dto/users.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { TeacherListResponseDto, TeacherResponseDto } from './dto/teacher-response.dto';
import { UserRole, JwtPayload } from '@biddaloy/shared';
import { SETTINGS_RATE_LIMIT, STRICT_RATE_LIMIT } from '../../rate-limit';
import { InvitationService } from '../account-access/invitation.service';

@ApiTags('users')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly teacherService: TeacherService,
    private readonly invitationService: InvitationService,
    private readonly recoveryService: RecoveryService,
  ) {}

  // --- User endpoints ---

  @Post('users')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  async createUser(
    @Body() dto: CreateUserDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() jwt: JwtPayload,
  ) {
    const { user, membership } = await this.userService.create(dto, tenant.id);
    // The freshly created entity has no user_tenants relation loaded, so
    // fromEntity would report role: null — take it from the membership we
    // just created instead.
    const userDto = UserResponseDto.fromEntity(user, tenant.id);
    userDto.role = membership.role;
    userDto.member_since = membership.created_at;

    // A passwordless account gets its activation link dispatched right
    // here — a delivery failure must never roll back the user that was
    // just created, so it's caught rather than allowed to propagate.
    let invitation: Awaited<ReturnType<InvitationService['issueAndSend']>> | null = null;
    if (!dto.password) {
      try {
        invitation = await this.invitationService.issueAndSend({
          userId: user.id,
          tenantId: tenant.id,
          actorUserId: jwt.sub,
        });
      } catch {
        invitation = null;
      }
    }
    userDto.invitation_status = await this.invitationService.statusFor(user);

    return { user: userDto, membership, invitation };
  }

  @Post('users/:id/invitation/resend')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @HttpCode(200)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary: 'Re-issue an invitation link, revoking any prior link for this user.',
  })
  async resendInvitation(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() jwt: JwtPayload,
  ) {
    return this.invitationService.issueAndSend({
      userId: id,
      tenantId: tenant.id,
      actorUserId: jwt.sub,
    });
  }

  @Post('users/:id/reset-password')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary:
      "Admin-initiated password reset (#396's server half). Sends an OTP/link to the target's " +
      'own contact and revokes their sessions immediately.',
  })
  async resetPassword(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() jwt: JwtPayload,
    @Req() request: Request,
  ) {
    // Asserts the target actually belongs to this tenant (404 otherwise) —
    // the same check every other `users/:id` route relies on.
    const user = await this.userService.findOne(id, tenant.id);
    return this.recoveryService.adminReset({
      user,
      tenantId: tenant.id,
      actorUserId: jwt.sub,
      context: requestContext(request),
    });
  }

  @Delete('users/:id/invitation')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: 'Revoke any live invitation link for this user.' })
  async revokeInvitation(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() jwt: JwtPayload,
  ) {
    return this.invitationService.revoke({ userId: id, tenantId: tenant.id, actorUserId: jwt.sub });
  }

  @Get('users')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  async findAllUsers(
    @Query() query: QueryUserDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const result = await this.userService.findAll(query, tenant.id);
    return { ...result, data: result.data.map((u) => UserResponseDto.fromEntity(u, tenant.id)) };
  }

  /**
   * MUST stay declared above `users/:id` and `users/:id` (PATCH) — those
   * routes have no `ParseUUIDPipe` on their param, so Nest (which matches
   * in declaration order) would otherwise capture `me` as a user id. [5.4a]
   */
  @Get('users/me')
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
  )
  @ApiOperation({
    summary:
      "Read the calling user's own record. The id comes from the JWT, never the path — a caller can only ever read themselves.",
  })
  @ApiResponse({ status: 200, type: UserResponseDto })
  async findMe(
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() jwt: JwtPayload,
  ) {
    const user = await this.userService.findOne(jwt.sub, tenant.id);
    const dto = UserResponseDto.fromEntity(user, tenant.id);
    dto.invitation_status = await this.invitationService.statusFor(user);
    return dto;
  }

  /**
   * See the ordering note on `GET users/me`.
   *
   * KNOWN, ACCEPTED: the 409 this can return is an account-existence oracle
   * — `users.email`/`users.phone` are unique GLOBALLY, so a parent in one
   * school can learn whether an address belongs to an account in any other.
   * The status code itself cannot be hidden: it IS the signal the profile
   * form needs, and login is already an oracle over the same column.
   *
   * What can be limited is the RATE of probing, which is what makes an
   * oracle worth attacking — one lookup is a nuisance, ten thousand is an
   * account list. Hence `SETTINGS_RATE_LIMIT` (20/60s), the tier
   * `rate-limit.ts` documents for exactly this shape: probing-sensitive but
   * cheap. `STRICT_RATE_LIMIT` (5/60s) is reserved there for genuinely
   * expensive endpoints, which a single-row profile write is not, and 5/60s
   * would sit on top of a normal edit-and-fix-a-typo session. [5.4a]
   */
  @Patch('users/me')
  @Throttle({ default: SETTINGS_RATE_LIMIT })
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
  )
  @ApiOperation({
    summary:
      "Update the calling user's own record. Only the UpdateOwnProfileDto fields are accepted; role/status/tenant fields are rejected with 400 by forbidNonWhitelisted. Changing email or phone requires `current_password` (400 if missing, 403 if wrong).",
  })
  @ApiResponse({ status: 200, type: UserResponseDto })
  async updateMe(
    @Body() dto: UpdateOwnProfileDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() jwt: JwtPayload,
  ) {
    const user = await this.userService.updateOwnProfile(jwt.sub, dto, tenant.id);
    return UserResponseDto.fromEntity(user, tenant.id);
  }

  @Get('users/:id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @ApiResponse({ status: 200, type: UserResponseDto })
  async findOneUser(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const user = await this.userService.findOne(id, tenant.id);
    const dto = UserResponseDto.fromEntity(user, tenant.id);
    dto.invitation_status = await this.invitationService.statusFor(user);
    return dto;
  }

  @Patch('users/:id')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  async updateUser(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const user = await this.userService.update(id, dto, tenant.id);
    return UserResponseDto.fromEntity(user, tenant.id);
  }

  @Delete('users/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: "Remove a member's access to this school (deletes the membership, not the account).",
  })
  removeUser(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.userService.remove(id, tenant.id, user.sub);
  }

  // --- Teacher endpoints ---

  @Post('teachers')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: 'Promote an existing tenant member to a teacher profile.' })
  @ApiResponse({ status: 201, type: TeacherResponseDto })
  async createTeacher(
    @Body() dto: CreateTeacherDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const teacher = await this.teacherService.create(dto, tenant.id);
    return TeacherResponseDto.fromEntity(teacher);
  }

  @Get('teachers')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @ApiResponse({ status: 200, type: TeacherListResponseDto })
  async findAllTeachers(
    @Query() query: QueryTeacherDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const result = await this.teacherService.findAll(query, tenant.id);
    return { ...result, data: result.data.map(TeacherResponseDto.fromEntity) };
  }

  @Patch('teachers/:id')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiResponse({ status: 200, type: TeacherResponseDto })
  async updateTeacher(
    @Param('id') id: string,
    @Body() dto: UpdateTeacherDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const teacher = await this.teacherService.update(id, dto, tenant.id);
    return TeacherResponseDto.fromEntity(teacher);
  }
}
