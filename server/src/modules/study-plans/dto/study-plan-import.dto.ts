import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { STUDY_PLAN_LIMITS } from '@biddaloy/shared';
import { BulkImportErrorDto } from '../../bulk-import/dto/bulk-import.dto';

/**
 * [66.2.07/#2012] Multipart body of `POST /study-plans/import/validate`: either
 * `class_id` + `subject_id` (plan targets) or `class_grade` + `subject_code`
 * (template target, D45). The pair rule is checked in the service.
 */
export class ValidateStudyPlanImportDto {
  @IsOptional() @IsUUID() class_id?: string;
  @IsOptional() @IsUUID() subject_id?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) class_grade?: number;
  @IsOptional() @IsString() @Length(1, 20) subject_code?: string;
}

export class ImportPlanScopeDto {
  @IsUUID() section_id: string;
  @IsUUID() subject_id: string;

  @ValidateIf((o: ImportPlanScopeDto) => o.academic_term_id !== null)
  @IsUUID()
  academic_term_id: string | null;
}

export class ImportTemplateTargetDto {
  @IsString() @Length(1, STUDY_PLAN_LIMITS.templateNameMax) name: string;
  @IsInt() @Min(1) @Max(12) class_grade: number;
  @IsString() @Length(1, 20) subject_code: string;
}

/** Body of `POST /study-plans/import/commit`: `staging_id` plus exactly one target. */
export class CommitStudyPlanImportDto {
  @IsUUID('4', { message: 'staging_id must be a valid id' })
  @IsNotEmpty({ message: 'Missing required field: staging_id' })
  staging_id: string;

  @IsOptional() @IsUUID() plan_id?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ImportPlanScopeDto)
  plan?: ImportPlanScopeDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ImportTemplateTargetDto)
  template?: ImportTemplateTargetDto;
}

export class StudyPlanImportPreviewRowDto {
  @ApiProperty() row: number;
  @ApiProperty() title: string;
  @ApiProperty() periods: number;
  @ApiPropertyOptional() topic?: string;
}

/** Response of `POST /study-plans/import/validate`. Nothing has been written yet. */
export class StudyPlanImportValidateResultDto {
  @ApiProperty() staging_id: string;
  @ApiProperty() expires_at: string;
  @ApiProperty() rows_to_create: number;
  @ApiProperty({ type: [StudyPlanImportPreviewRowDto] }) preview: StudyPlanImportPreviewRowDto[];
  @ApiProperty({ type: [BulkImportErrorDto] }) errors: BulkImportErrorDto[];
  @ApiProperty({ type: [BulkImportErrorDto] }) warnings: BulkImportErrorDto[];
  @ApiProperty() hard_error_count: number;
}

export class ProgressCsvQueryDto {
  @IsUUID() class_id: string;
  @IsUUID() academic_term_id: string;
}
