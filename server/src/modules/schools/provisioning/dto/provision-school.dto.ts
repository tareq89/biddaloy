import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * At least one non-empty invitation contact. Without an email or phone the
 * provisioned ADMIN would exist with a pending invitation that
 * `ProvisioningService.provisionAdminForSchool` can never deliver
 * (`pickChannel` finds nothing), so the school has an admin nobody can
 * reach. Attached to the always-required `name` field — same shape as
 * `HasEmailOrPhoneConstraint` (auth/dto/login.dto.ts) — because a
 * constraint on an `@IsOptional()` property is skipped when that property
 * is absent, which is exactly the case this needs to catch.
 */
@ValidatorConstraint({ name: 'hasAdminContact', async: false })
export class HasAdminContactConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const dto = args.object as ProvisionSchoolAdminDto;
    const hasText = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
    return hasText(dto.email) || hasText(dto.phone);
  }
  defaultMessage() {
    return 'Provide an email or a phone number for the admin invitation';
  }
}

export class ProvisionSchoolAdminDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Validate(HasAdminContactConstraint)
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  @MaxLength(100)
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;
}

/**
 * `POST /schools` (#529). Creates a school and its first ADMIN in one
 * atomic, idempotent request — see `ProvisioningService.provision`.
 */
export class ProvisionSchoolDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  slug: string;

  /** `@IsDefined()` because `@ValidateNested()` alone lets a missing `admin`
   * through — the service would then start a transaction and crash reading
   * `admin.email`, a 500 where a 400 belongs. */
  @ApiProperty({ type: ProvisionSchoolAdminDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => ProvisionSchoolAdminDto)
  admin: ProvisionSchoolAdminDto;

  /** Client-generated UUID — the same value replayed makes this call a
   * no-op that returns the original result instead of creating anything
   * twice. See `ProvisioningService.provision`'s Redis `SET ... NX EX`. */
  @ApiProperty()
  @IsUUID()
  idempotency_key: string;
}
