import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { INTERNATIONAL_PHONE_REGEX } from './users.dto';

/** Exactly one of `email`/`phone`, same "attach to the always-required
 * field" shape as `HasEmailOrPhoneConstraint` (auth/dto/login.dto.ts) and
 * `HasOtpOrTokenConstraint` (account-access/dto/reset-password.dto.ts) — a
 * constraint on an `@IsOptional()` property is skipped when that property
 * is absent, which is exactly the shape this needs to catch. */
@ValidatorConstraint({ name: 'hasExactlyOneContactField', async: false })
export class HasExactlyOneContactFieldConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const dto = args.object as ContactChangeRequestDto;
    const hasText = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
    return hasText(dto.email) !== hasText(dto.phone);
  }
  defaultMessage() {
    return 'Provide exactly one of email or phone, not both and not neither';
  }
}

/** Body of `POST /users/me/contact-change`. */
export class ContactChangeRequestDto {
  @ApiProperty({ required: false, description: 'The new email address to verify and switch to.' })
  @IsOptional()
  @IsEmail()
  @MaxLength(100)
  email?: string;

  @ApiProperty({ required: false, description: 'The new phone number to verify and switch to.' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(INTERNATIONAL_PHONE_REGEX, { message: 'Invalid phone format' })
  phone?: string;

  @ApiProperty({ description: "The caller's current password, proving they own this account." })
  @IsString()
  @MaxLength(200)
  @Validate(HasExactlyOneContactFieldConstraint)
  current_password: string;
}

/** Body of `POST /users/me/contact-change/confirm-phone`. */
export class ContactChangeConfirmPhoneDto {
  @ApiProperty({ description: 'The 6-digit OTP sent to the new phone number.' })
  @IsString()
  @Matches(/^[0-9০-৯]{6}$/, { message: 'otp must be a 6-digit code' })
  otp: string;
}

/** Body of `POST /auth/verify-email` — the public link-click confirm. */
export class VerifyEmailDto {
  @ApiProperty({ description: 'The raw email-verify token from the ?token= query param.' })
  @IsString()
  @MaxLength(200)
  token: string;
}
