import { ApiProperty } from '@nestjs/swagger';
import { UserRole, UserStatus, InvitationStatus } from '@biddaloy/shared';
import { User } from '../entities/user.entity';

const INVITATION_STATUS_VALUES: InvitationStatus[] = [
  'NONE',
  'PENDING',
  'EXPIRED',
  'REVOKED',
  'ACTIVATED',
];

/**
 * The public shape of a User — everything except `password_hash`.
 *
 * UserService methods return the full entity for internal use (the
 * bcrypt hash is exactly what the login flow needs to compare against);
 * this is the boundary where a response leaving the API must never carry
 * it. Build one with `UserResponseDto.fromEntity`, not `new` directly.
 */
export class UserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true, type: String })
  email: string | null;

  @ApiProperty({ nullable: true, type: String })
  phone: string | null;

  @ApiProperty({ enum: UserStatus })
  status: UserStatus;

  @ApiProperty()
  full_name: string;

  /** The caller's-tenant membership role — tenant-scoped, not a global
   * user attribute (`user_tenants.role`). Null when the entity was built
   * without its memberships loaded, or the user somehow has none in the
   * active tenant. Added for [8.11.8]'s staff list/detail (Role column,
   * read-only ROLE_PERMISSIONS tab), which cannot exist without it. */
  @ApiProperty({ enum: UserRole, nullable: true })
  role: UserRole | null;

  /** When the active-tenant membership was created (`user_tenants.created_at`)
   * — the real "member since" date. `user.created_at` is the global account
   * date, which predates the membership when an existing account joins a
   * second school. Null under the same conditions as `role`. */
  @ApiProperty({ nullable: true, type: Date })
  member_since: Date | null;

  @ApiProperty({ nullable: true, type: String })
  profile_picture_url: string | null;

  @ApiProperty({ nullable: true, type: Object })
  preferences: Record<string, unknown> | null;

  @ApiProperty({ nullable: true, type: Date })
  last_login_at: Date | null;

  @ApiProperty()
  created_at: Date;

  @ApiProperty()
  updated_at: Date;

  /** Derived account-access lifecycle (12.1's D1) — see `deriveInvitationStatus`.
   * Not set by `fromEntity` itself (it needs an async lookup of the user's
   * latest invite token); callers populate it separately via
   * `InvitationService.statusFor`. */
  @ApiProperty({ enum: INVITATION_STATUS_VALUES })
  invitation_status: InvitationStatus;

  static fromEntity(user: User, tenantId?: string): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.phone = user.phone;
    dto.status = user.status;
    const membership = tenantId
      ? user.user_tenants?.find((ut) => ut.tenant_id === tenantId)
      : undefined;
    dto.role = membership?.role ?? null;
    dto.member_since = membership?.created_at ?? null;
    dto.full_name = user.full_name;
    dto.profile_picture_url = user.profile_picture_url;
    dto.preferences = user.preferences;
    dto.last_login_at = user.last_login_at;
    dto.created_at = user.created_at;
    dto.updated_at = user.updated_at;
    return dto;
  }
}
