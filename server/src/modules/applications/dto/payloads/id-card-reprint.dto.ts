import { IsString, MaxLength, MinLength } from 'class-validator';
import { SanitizeText } from '../../../../common/decorators/sanitize-text.decorator';

/** ID_CARD_REPRINT payload (student or staff subject). */
export class IdCardReprintPayloadDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  @SanitizeText()
  reason: string;
}
