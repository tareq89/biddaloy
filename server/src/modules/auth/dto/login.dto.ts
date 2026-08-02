import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

// Attached to `password` (never @IsOptional) rather than to email/phone
// themselves, since a constraint on an @IsOptional() property is skipped
// entirely when that property is absent — which is exactly the case this
// needs to catch.
@ValidatorConstraint({ name: 'hasEmailOrPhone', async: false })
export class HasEmailOrPhoneConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const dto = args.object as LoginDto;
    return !!(dto.email || dto.phone);
  }
  defaultMessage() {
    return 'Either email or phone is required';
  }
}

export class LoginDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @MinLength(1)
  @Validate(HasEmailOrPhoneConstraint)
  password: string;
}