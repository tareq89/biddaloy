import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IMPERSONATION_REASON_MAX, IMPERSONATION_REASON_MIN, UserRole } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

const LOGIN_AS_ROLES = Object.values(UserRole).filter((r) => r !== UserRole.SUPER_ADMIN);

/** Wire shape of `StartImpersonationRequest` in shared. `approvalToken` is header-only. */
export class StartImpersonationDto {
  @IsUUID()
  schoolId: string;

  @IsIn(LOGIN_AS_ROLES)
  role: UserRole;

  @IsUUID()
  targetUserId: string;

  @SanitizeText()
  @IsString()
  @MinLength(IMPERSONATION_REASON_MIN)
  @MaxLength(IMPERSONATION_REASON_MAX)
  reason: string;

  @IsBoolean()
  viewOnly: boolean;

  /** An approved `ask` request to redeem (single use). */
  @IsOptional()
  @IsUUID()
  ticketId?: string;
}

/** Owner asks the school to let an emergency session write. */
export class RequestWriteDto {
  @SanitizeText()
  @IsString()
  @MinLength(IMPERSONATION_REASON_MIN)
  @MaxLength(IMPERSONATION_REASON_MAX)
  reason: string;
}

export class ListImpersonationQueryDto {
  @IsOptional()
  @IsIn(['live', 'recent'])
  scope?: 'live' | 'recent' = 'live';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}
