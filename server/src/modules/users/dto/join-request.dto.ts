import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, MaxLength, Matches, ValidateIf } from 'class-validator';
import { STAFF_ROLES, UserRole } from '@biddaloy/shared';
import { INTERNATIONAL_PHONE_REGEX } from './users.dto';

/** "Add staff" for someone who already has an account: they accept before they join. */
export class JoinRequestDto {
  // Each field is validated unless the other stands alone, so at least one is always present.
  @ApiPropertyOptional()
  @ValidateIf((o: JoinRequestDto) => !o.phone || !!o.email)
  @IsEmail()
  @MaxLength(100)
  email?: string;

  @ApiPropertyOptional()
  @ValidateIf((o: JoinRequestDto) => !o.email || !!o.phone)
  @IsString()
  @MaxLength(20)
  @Matches(INTERNATIONAL_PHONE_REGEX, { message: 'Invalid phone format' })
  phone?: string;

  @ApiProperty({ enum: UserRole })
  @IsIn([...STAFF_ROLES])
  role: UserRole;
}

export class JoinRequestResponseDto {
  @ApiProperty({ enum: ['PENDING'] })
  status: 'PENDING';
}
