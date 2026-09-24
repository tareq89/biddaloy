import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  MaxLength,
  MinLength,
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

  @SanitizeText()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @IsOptional()
  @SanitizeText()
  description?: string | null;

  @IsInt()
  sequence: number;

  @IsOptional()
  @IsEnum(SyllabusTopicStatus)
  status?: SyllabusTopicStatus;
}

export class UpdateSyllabusTopicDto {
  @IsOptional()
  @SanitizeText()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @SanitizeText()
  description?: string | null;

  @IsOptional()
  @IsInt()
  sequence?: number;

  @IsOptional()
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
  subject_name_en: string | null;
  subject_name_bn: string | null;
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
    subject_name_en: topic.subject?.name_en ?? null,
    subject_name_bn: topic.subject?.name_bn ?? null,
    name: topic.name,
    description: topic.description,
    sequence: topic.sequence,
    status: topic.status,
  };
}
