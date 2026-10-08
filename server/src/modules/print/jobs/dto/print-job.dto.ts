import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsObject,
  IsUUID,
  MaxLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { PRINT_BATCH_CEILING, PrintContextType } from '@biddaloy/shared';

/** Shape only; the per-field maxLength and which keys are allowed depend on the template (service). */
@ValidatorConstraint({ name: 'issueValues', async: false })
class IssueValuesConstraint implements ValidatorConstraintInterface {
  validate(v: unknown) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
    const entries = Object.entries(v);
    return (
      entries.length <= 20 && entries.every(([, x]) => typeof x === 'string' && x.length <= 500)
    );
  }
  defaultMessage(_a: ValidationArguments) {
    return 'issue_values must be at most 20 string values of at most 500 characters';
  }
}

export class PreviewPrintJobDto {
  @ApiProperty()
  @IsUUID()
  template_id: string;

  @ApiProperty({ enum: ['STUDENT', 'STAFF', 'ACR'] })
  @IsIn(['STUDENT', 'STAFF', 'ACR'])
  subject_type: 'STUDENT' | 'STAFF' | 'ACR';

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PRINT_BATCH_CEILING)
  @IsUUID('all', { each: true })
  subject_ids: string[];

  @ApiPropertyOptional({ enum: Object.values(PrintContextType) })
  @IsOptional()
  @IsIn(Object.values(PrintContextType))
  context_type?: PrintContextType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  context_id?: string;

  /** Typed by the issuer for the template's `issue.*` fields (D3); one set for every subject. */
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' } })
  @IsOptional()
  @IsObject()
  @Validate(IssueValuesConstraint)
  issue_values?: Record<string, string>;
}

export class CreatePrintJobDto extends PreviewPrintJobDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  printer_profile_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  batch_label?: string;
}
