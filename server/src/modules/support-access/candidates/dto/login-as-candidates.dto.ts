import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { UserRole } from '@biddaloy/shared';

export const LOGIN_AS_ROLES = Object.values(UserRole).filter((r) => r !== UserRole.SUPER_ADMIN);

export class LoginAsCandidatesQueryDto {
  @IsIn(LOGIN_AS_ROLES)
  role: UserRole;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}
