import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ProvisionSchoolAdminDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
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

  @ApiProperty({ type: ProvisionSchoolAdminDto })
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
