import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { toLatinDigits } from '../../../common/utils/bengali-digits.util';
import { INTERNATIONAL_PHONE_REGEX } from '../../users/dto/users.dto';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** An email address or an international phone number — each alternative is fully anchored. */
export const EMAIL_OR_PHONE_REGEX = new RegExp(
  `${EMAIL_REGEX.source}|${INTERNATIONAL_PHONE_REGEX.source}`,
);

export const latinDigits = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? toLatinDigits(value) : value;

/**
 * Body of `POST /auth/otp/request` — enumeration-safe: the response is
 * identical (202, no body) whether or not the identifier matches an account.
 * Send `identifier` (phone or email) — or the older `phone` alias; one of the two is required.
 */
export class OtpRequestDto {
  @ApiProperty({
    required: false,
    description: 'The phone number or email on the account. Either `identifier` or `phone`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(254)
  @Transform(latinDigits)
  @Matches(EMAIL_OR_PHONE_REGEX, { message: 'Invalid email or phone format' })
  identifier?: string;

  @ApiProperty({ required: false, description: 'Alias of `identifier` for older clients.' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(latinDigits)
  @Matches(INTERNATIONAL_PHONE_REGEX, { message: 'Invalid phone format' })
  phone?: string;
}
