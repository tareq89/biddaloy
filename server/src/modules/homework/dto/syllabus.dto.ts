import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SyllabusTopicStatus } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';
import { SyllabusTopic } from '../entities/syllabus-topic.entity';

export class CreateSyllabusTopicDto {
  @IsUUID()
  class_id: string;

  @IsUUID()
  subject_id: string;

  @IsString()
  @SanitizeText()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @SanitizeText()
  @MaxLength(2000)
  description?: string | null;

  @IsInt()
  sequence: number;

  @IsOptional()
  @IsEnum(SyllabusTopicStatus)
  status?: SyllabusTopicStatus;
}

export class UpdateSyllabusTopicDto {
  // `@IsOptional()` skips validation for both `undefined` AND `null` — a
  // body like `{ name: null }` would pass and reach the service. These
  // fields are non-nullable, so validate whenever the key is present at
  // all, `null` included; only genuinely absent (`undefined`) is skipped.
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @SanitizeText()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @SanitizeText()
  @MaxLength(2000)
  description?: string | null;

  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  sequence?: number;

  @ValidateIf((_, v) => v !== undefined)
  @IsEnum(SyllabusTopicStatus)
  status?: SyllabusTopicStatus;
}

export class ReorderSyllabusTopicItemDto {
  @IsUUID()
  id: string;

  @IsInt()
  sequence: number;
}

export class ReorderSyllabusTopicsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReorderSyllabusTopicItemDto)
  items: ReorderSyllabusTopicItemDto[];
}

export class SyllabusTopicResponseDto {
  id: string;
  class_id: string;
  subject_id: string;
  name: string;
  description: string | null;
  sequence: number;
  status: SyllabusTopicStatus;
}

export function toSyllabusTopicResponseDto(topic: SyllabusTopic): SyllabusTopicResponseDto {
  return {
    id: topic.id,
    class_id: topic.class_id,
    subject_id: topic.subject_id,
    name: topic.name,
    description: topic.description,
    sequence: topic.sequence,
    status: topic.status,
  };
}
