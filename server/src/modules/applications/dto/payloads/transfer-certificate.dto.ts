import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SanitizeText } from '../../../../common/decorators/sanitize-text.decorator';

/** TRANSFER_CERTIFICATE payload. */
export class TransferCertificatePayloadDto {
  @IsDateString({ strict: true }, { message: 'leaving_date must be a valid YYYY-MM-DD date' })
  leaving_date: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @SanitizeText()
  destination?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  @SanitizeText()
  reason: string;
}
