import {
  IsUUID,
  IsOptional,
  IsArray,
  ArrayNotEmpty,
  ValidateNested,
  IsEnum,
  IsNumberString,
  IsNotEmpty,
  Validate,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MarkStatus, MarkGridState } from '@biddaloy/shared';
import { IsNonNegativeMarksStringConstraint } from './exams.dto';

export class MarkCellDto {
  @IsNotEmpty()
  @IsUUID()
  student_id: string;

  @IsNotEmpty()
  @IsUUID()
  component_id: string;

  // Bounds only — "value <= this component's full_marks" needs the
  // component looked up, so that half of D10's rule is enforced in
  // MarksService, not here.
  @IsOptional()
  @IsNumberString()
  @Validate(IsNonNegativeMarksStringConstraint)
  value?: string | null;

  @IsNotEmpty()
  @IsEnum(MarkStatus)
  status: MarkStatus;
}

export class BatchMarksDto {
  @IsNotEmpty()
  @IsUUID()
  section_id: string;

  @IsNotEmpty()
  @IsUUID()
  subject_id: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => MarkCellDto)
  cells: MarkCellDto[];
}

export class GridQueryDto {
  @IsNotEmpty()
  @IsUUID()
  section_id: string;

  @IsNotEmpty()
  @IsUUID()
  subject_id: string;
}

export class GridStateActionDto {
  @IsNotEmpty()
  @IsUUID()
  section_id: string;

  @IsNotEmpty()
  @IsUUID()
  subject_id: string;
}

export class QueryProgressDto {
  @IsOptional()
  @IsEnum(MarkGridState)
  state?: MarkGridState;
}
