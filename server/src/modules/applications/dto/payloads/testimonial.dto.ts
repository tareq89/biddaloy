import { IsString, MaxLength, MinLength } from 'class-validator';
import { SanitizeText } from '../../../../common/decorators/sanitize-text.decorator';

/** TESTIMONIAL payload. */
export class TestimonialPayloadDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  @SanitizeText()
  purpose: string;
}
