import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { SanitizeText } from '../../../../common/decorators/sanitize-text.decorator';

/** SECTION_CHANGE payload. */
export class SectionChangePayloadDto {
  @IsUUID()
  to_section_id: string;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  @SanitizeText()
  reason: string;
}
