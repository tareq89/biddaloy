import { IsString, MaxLength, MinLength } from 'class-validator';
import { SanitizeText } from '../../../../common/decorators/sanitize-text.decorator';

/** GENERAL payload. Addressee and tags live on the application, not here. */
export class GeneralPayloadDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  @SanitizeText()
  subject_line: string;

  @IsString()
  @MinLength(3)
  @MaxLength(5000)
  @SanitizeText()
  body: string;
}
