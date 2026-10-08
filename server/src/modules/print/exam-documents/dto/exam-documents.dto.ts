import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const MERIT_SCOPES = ['CLASS', 'SECTION'] as const;
export type MeritScope = (typeof MERIT_SCOPES)[number];

/** [48.2.05] D29: class positions 1-3 by default; scope and N are chosen at print time. */
export class MeritCandidatesQueryDto {
  @ApiPropertyOptional({ enum: MERIT_SCOPES, default: 'CLASS' })
  @IsOptional()
  @IsIn(MERIT_SCOPES)
  scope: MeritScope = 'CLASS';

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  top: number = 3;
}

export class AdmitCardStudentDto {
  @ApiProperty() student_id: string;
  @ApiProperty() full_name: string;
  @ApiProperty() roll_number: number;
  @ApiProperty({ nullable: true, type: String }) section_name: string | null;
  @ApiProperty() printed_copies: number;
  @ApiProperty({ nullable: true, type: String }) last_printed_at: string | null;
  /** `null` when the school does not withhold for dues; never an amount. */
  @ApiProperty({ nullable: true, type: Boolean }) has_dues: boolean | null;
}

export class AdmitCardRosterDto {
  @ApiProperty() withhold_for_dues: boolean;
  @ApiProperty() seat_plan_published: boolean;
  @ApiProperty({ type: [AdmitCardStudentDto] }) students: AdmitCardStudentDto[];
}

export class MeritCandidateDto {
  @ApiProperty() student_id: string;
  @ApiProperty() full_name: string;
  @ApiProperty({ nullable: true, type: String }) section_name: string | null;
  @ApiProperty() position: number;
  @ApiProperty({ nullable: true, type: Number }) section_position: number | null;
  @ApiProperty() gpa: number;
}
