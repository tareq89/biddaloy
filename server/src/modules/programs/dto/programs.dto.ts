import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';
import { Program } from '../entities/program.entity';
import { ProgramMilestone } from '../entities/program-milestone.entity';

export class CreateProgramDto {
  @SanitizeText()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @SanitizeText()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  show_on_report_card?: boolean;
}

export class UpdateProgramDto {
  @IsOptional()
  @SanitizeText()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @SanitizeText()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  show_on_report_card?: boolean;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CreateMilestoneDto {
  @SanitizeText()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @SanitizeText()
  @MaxLength(2000)
  description?: string | null;
}

export class UpdateMilestoneDto {
  @IsOptional()
  @SanitizeText()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @SanitizeText()
  @MaxLength(2000)
  description?: string | null;
}

export class ReorderMilestonesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  milestone_ids: string[];
}

export class ListProgramsQuery {
  // `@Type(() => Boolean)` deliberately not used: class-transformer's Boolean
  // coercion is `Boolean(value)`, which treats the string "false" as truthy —
  // `?include_archived=false` would silently become `true`. This transform
  // parses the two literal strings a query param can actually carry.
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  include_archived?: boolean;
}

export class ProgramMilestoneDto {
  id: string;
  program_id: string;
  name: string;
  description: string | null;
  sequence: number;
  /** Only populated on `GET /programs/:id` (D23: shown in the delete
   * confirm before the cascade removes the achievements). */
  achievement_count?: number;
}

export class ProgramDto {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  show_on_report_card: boolean;
  milestone_count?: number;
  active_enrollment_count?: number;
  milestones?: ProgramMilestoneDto[];
}

export function toMilestoneDto(
  milestone: ProgramMilestone,
  achievementCount?: number,
): ProgramMilestoneDto {
  return {
    id: milestone.id,
    program_id: milestone.program_id,
    name: milestone.name,
    description: milestone.description,
    sequence: milestone.sequence,
    ...(achievementCount !== undefined ? { achievement_count: achievementCount } : {}),
  };
}

export function toProgramDto(
  program: Program,
  counts?: { milestone_count: number; active_enrollment_count: number },
  milestones?: ProgramMilestone[],
): ProgramDto {
  return {
    id: program.id,
    name: program.name,
    description: program.description,
    is_active: program.is_active,
    show_on_report_card: program.show_on_report_card,
    ...(counts ? { milestone_count: counts.milestone_count } : {}),
    ...(counts ? { active_enrollment_count: counts.active_enrollment_count } : {}),
    ...(milestones ? { milestones: milestones.map(toMilestoneDto) } : {}),
  };
}
