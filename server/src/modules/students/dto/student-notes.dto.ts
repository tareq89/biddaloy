import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
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

  /** [28.2.x] Optional 1-5 rating; omitted stays null. */
  @ApiProperty({ required: false, minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;
}

export class StudentNoteResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() body: string;
  @ApiProperty({ type: Number, nullable: true }) rating: number | null;
  @ApiProperty({ type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } })
  author: { id: string; name: string };
  @ApiProperty() created_at: Date;
}
