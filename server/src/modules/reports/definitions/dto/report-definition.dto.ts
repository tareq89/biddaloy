import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { ReportDefinitionJson } from '@biddaloy/shared';
import { ReportDefinitionStatus, UserRole } from '@biddaloy/shared';

/** The roles a report can be shown to. Guardians and students cannot run defined reports (D13). */
export const REPORT_VISIBLE_ROLES = [
  UserRole.ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.EXECUTIVE,
  UserRole.TEACHER,
  UserRole.COMMITTEE,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
] as const;

export class CreateReportDefinitionDto {
  @ApiProperty({ example: 'dues-by-class' })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,78}$/, {
    message: 'key must be lowercase letters, digits and dashes',
  })
  key: string;

  @ApiProperty() @IsString() @MinLength(1) @MaxLength(160) name_en: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(160) name_bn: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) folder?: string;

  @ApiPropertyOptional({
    enum: REPORT_VISIBLE_ROLES,
    isArray: true,
    description: 'Roles that may run it. Empty: every role that can open reports.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(REPORT_VISIBLE_ROLES.length)
  @IsIn(REPORT_VISIBLE_ROLES, { each: true })
  visible_roles?: string[];

  /** Checked against the registry by the compiler's validator, not by decorators. */
  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  definition: ReportDefinitionJson;
}

export class UpdateReportDefinitionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(160) name_en?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(160) name_bn?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) folder?: string;

  @ApiPropertyOptional({ enum: REPORT_VISIBLE_ROLES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(REPORT_VISIBLE_ROLES.length)
  @IsIn(REPORT_VISIBLE_ROLES, { each: true })
  visible_roles?: string[];

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  definition?: ReportDefinitionJson;
}

export class ReportDefinitionDto {
  @ApiProperty() id: string;
  @ApiProperty() key: string;
  @ApiProperty() name_en: string;
  @ApiProperty() name_bn: string;
  @ApiProperty({ nullable: true, type: String }) folder: string | null;
  @ApiProperty({ enum: ReportDefinitionStatus }) status: ReportDefinitionStatus;
  @ApiProperty({ type: [String] }) visible_roles: string[];
  @ApiProperty({ nullable: true, type: String }) current_version_id: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Set on a copy of a ready report.' })
  system_template_key: string | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'The latest published version number.',
  })
  version: number | null;
  @ApiProperty() updated_at: string;
}

export class ReportDefinitionDetailDto extends ReportDefinitionDto {
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  draft: ReportDefinitionJson | null;
}

export class CatalogueEntryDto {
  @ApiProperty() id: string;
  @ApiProperty() key: string;
  @ApiProperty() name_en: string;
  @ApiProperty() name_bn: string;
  @ApiProperty({ description: 'The published version a run uses.' }) version_id: string;
  @ApiProperty({ nullable: true, type: String }) system_template_key: string | null;
}

export class CatalogueFolderDto {
  @ApiProperty({ nullable: true, type: String }) folder: string | null;
  @ApiProperty({ type: [CatalogueEntryDto] }) reports: CatalogueEntryDto[];
}

/** Query for the definitions list. */
export class ListReportDefinitionsQueryDto {
  @ApiPropertyOptional({ enum: ReportDefinitionStatus })
  @IsOptional()
  @IsEnum(ReportDefinitionStatus)
  @Type(() => String)
  status?: ReportDefinitionStatus;
}
