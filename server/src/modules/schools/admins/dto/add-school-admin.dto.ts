import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * `POST /schools/:id/admins` (#531) — same shape as
 * `ProvisionSchoolAdminDto` (#529's `POST /schools`), kept as its own DTO
 * so this lane's files never overlap with the provisioning DTO's file.
 */
export class AddSchoolAdminDto {
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
