import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** A new device needs BOTH codes: one sent by SMS and one by email. */
export class CockpitDeviceOtpDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  deviceToken: string;

  @IsString()
  @MinLength(1)
  @MaxLength(16)
  smsCode: string;

  @IsString()
  @MinLength(1)
  @MaxLength(16)
  emailCode: string;

  @IsOptional()
  @IsBoolean()
  rememberDevice?: boolean;
}
