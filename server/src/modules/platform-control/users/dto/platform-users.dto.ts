import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { UserRole } from '@biddaloy/shared';

export const PLATFORM_USER_SEARCH_MIN = 3;

export class SearchPlatformUsersQueryDto {
  /** Email (exact) or phone (suffix). Trimmed; at least 3 characters. */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(PLATFORM_USER_SEARCH_MIN)
  @MaxLength(100)
  q: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export interface PlatformUserMembership {
  /** `user_tenants.id`, so the Login as dialog can be prefilled. */
  memberId: string;
  schoolId: string;
  schoolName: string;
  role: UserRole;
}

export interface PlatformUserItem {
  userId: string;
  fullName: string;
  emailMasked: string | null;
  phoneMasked: string | null;
  status: string;
  locked: boolean;
  lastLoginAt: string | null;
  memberships: PlatformUserMembership[];
}
