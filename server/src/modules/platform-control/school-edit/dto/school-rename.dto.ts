import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** [Epic 99, D7] Rename body. Same length rules as `UpdateSchoolProfileDto`; slug and domain never change. */
export class SchoolRenameDto {
  // An omitted name leaves it unchanged; null is rejected (schools.name is NOT NULL).
  @ApiPropertyOptional({ maxLength: 200 })
  @ValidateIf((_, v) => v !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ maxLength: 200, nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  name_bn?: string | null;

  @ApiProperty({ maxLength: 500 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;
}

export class SchoolRenameResponseDto {
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true }) name_bn: string | null;
  /** False when nothing changed (no audit row written). */
  @ApiProperty() changed: boolean;
}
