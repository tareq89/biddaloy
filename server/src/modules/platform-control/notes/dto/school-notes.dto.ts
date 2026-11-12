import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const NOTE_MAX = 2000;

export class AddSchoolNoteDto {
  /** Plain text, trimmed. The client must render it escaped. */
  @ApiProperty({ minLength: 1, maxLength: NOTE_MAX })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(NOTE_MAX)
  text: string;
}

export class ListSchoolNotesQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class SchoolNoteResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() authorId: string;
  @ApiProperty() text: string;
  @ApiProperty() createdAt: string;
}
