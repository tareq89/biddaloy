import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsISO31661Alpha2,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { INTERNATIONAL_PHONE_REGEX } from '../../users/dto/users.dto';
import { latinDigits } from '../../account-access/dto/otp-request.dto';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Body of `POST /auth/register/start` — the seven fields a stranger fills in, plus the captcha. */
export class RegisterStartDto {
  @ApiProperty()
  @Transform(trim)
  @SanitizeText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  admin_name: string;

  @ApiProperty()
  @Transform(trim)
  @SanitizeText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  school_name: string;

  @ApiProperty({ example: 'BD' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsISO31661Alpha2()
  country_code: string;

  @ApiProperty()
  @Transform(trim)
  @SanitizeText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  address: string;

  @ApiProperty()
  @Transform(({ value }) => trim({ value: latinDigits({ value }) }))
  @IsString()
  @MaxLength(20)
  @Matches(INTERNATIONAL_PHONE_REGEX, { message: 'Invalid phone format' })
  phone: string;

  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(100)
  email: string;

  @ApiProperty({ description: 'Must be true.' })
  @Equals(true, { message: 'The terms must be accepted' })
  terms_accepted: boolean;

  @ApiProperty({ description: 'Cloudflare Turnstile token.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  captcha_token: string;
}
