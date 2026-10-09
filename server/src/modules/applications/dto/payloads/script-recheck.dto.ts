import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { SanitizeText } from '../../../../common/decorators/sanitize-text.decorator';

/** SCRIPT_RECHECK payload. */
export class ScriptRecheckPayloadDto {
  @IsUUID()
  exam_id: string;

  @IsUUID()
  subject_id: string;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  @SanitizeText()
  reason: string;
}
