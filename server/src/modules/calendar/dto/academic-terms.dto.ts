import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';
import { AcademicTerm } from '../entities/academic-term.entity';

export class CreateTermDto {
  @IsUUID()
  academic_year_id: string;

  @SanitizeText()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @IsDateString()
  start_date: string;

  @IsDateString()
  end_date: string;
}

export class UpdateTermDto {
  @IsOptional()
  @SanitizeText()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;
}

export class ReorderTermsDto {
  @IsUUID()
  academic_year_id: string;

  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  ids: string[];
}

export class TermResponseDto {
  id: string;
  academic_year_id: string;
  seq: number;
  name: string;
  start_date: string;
  end_date: string;
}

export function toTermResponseDto(term: AcademicTerm): TermResponseDto {
  return {
    id: term.id,
    academic_year_id: term.academic_year_id,
    seq: term.seq,
    name: term.name,
    start_date: term.start_date,
    end_date: term.end_date,
  };
}
