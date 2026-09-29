import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { DocumentKind, PRINT_BATCH_CEILING } from '@biddaloy/shared';

/** Query for `GET /print-templates`. */
export class ListPrintTemplatesQueryDto {
  @ApiPropertyOptional({ enum: DocumentKind })
  @IsOptional()
  @IsEnum(DocumentKind)
  document_kind?: DocumentKind;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === 'false' ? false : value === 'true' ? true : value))
  @IsBoolean()
  include_archived?: boolean;
}

/** Body for `POST /print-templates` — a suggestion is required (D50). */
export class CreatePrintTemplateDto {
  @ApiProperty()
  @IsString()
  @Length(1, 120)
  name: string;

  @ApiProperty({ description: 'Key from GET /print-templates/suggestions.' })
  @IsString()
  @Length(1, 80)
  suggestion_key: string;
}

/** Body for `PATCH /print-templates/:id`. `draft` is validated by the service against the shared schema. */
export class UpdatePrintTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: PRINT_BATCH_CEILING })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PRINT_BATCH_CEILING)
  batch_size?: number;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  draft?: Record<string, unknown>;
}
