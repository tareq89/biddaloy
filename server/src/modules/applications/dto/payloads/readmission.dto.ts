import { IsDateString, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { SanitizeText } from '../../../../common/decorators/sanitize-text.decorator';

/** READMISSION payload. */
export class ReadmissionPayloadDto {
  @IsUUID()
  class_section_id: string;

  @IsDateString({ strict: true }, { message: 'occurred_on must be a valid YYYY-MM-DD date' })
  occurred_on: string;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  @SanitizeText()
  reason: string;
}
