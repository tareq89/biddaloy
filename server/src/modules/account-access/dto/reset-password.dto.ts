import { ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../../auth/password-policy';

// Attached to `new_password` (never @IsOptional) for the same reason
// `HasEmailOrPhoneConstraint` (auth/dto/login.dto.ts) is attached to
// `password` rather than to email/phone themselves — a constraint on an
// @IsOptional() property is skipped entirely when that property is absent,
// which is exactly the shape this needs to catch.
@ValidatorConstraint({ name: 'hasOtpOrToken', async: false })
export class HasOtpOrTokenConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const dto = args.object as ResetPasswordDto;
    const hasText = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
    const hasOtpPair = hasText(dto.phone) && hasText(dto.otp);
    const hasToken = hasText(dto.token);
    // Exactly one of the two credential shapes — never both, never neither.
    return hasOtpPair !== hasToken;
  }
  defaultMessage() {
    return 'Provide either { phone, otp } or { token }, not both and not neither';
  }
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'The password to set.', minLength: PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(200)
  @Validate(HasOtpOrTokenConstraint)
  new_password: string;

  @ApiProperty({ required: false, description: 'The phone number the OTP was sent to.' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiProperty({ required: false, description: 'The 6-digit OTP sent by SMS.' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9০-৯]{6}$/, { message: 'otp must be a 6-digit code' })
  otp?: string;

  @ApiProperty({ required: false, description: 'The reset token from the emailed link.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  token?: string;
}
