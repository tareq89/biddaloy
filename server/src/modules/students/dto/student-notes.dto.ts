import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

/** [39.2.1] D29 — create only; notes have no edit. */
export class CreateStudentNoteDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  // Sanitize first, then trim: markup-only input like `<b> </b>` must end up blank, not " ".
  @SanitizeText()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 2000)
  body: string;
}

export class StudentNoteResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() body: string;
  @ApiProperty({ type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } })
  author: { id: string; name: string };
  @ApiProperty() created_at: Date;
}
