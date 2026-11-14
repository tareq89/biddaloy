import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsInt,
  Min,
  Max,
  IsArray,
  IsEnum,
  IsIn,
  IsBoolean,
  IsOptional,
  ArrayMaxSize,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AdmissionDocumentType,
  AdmissionPayMethod,
  AdmissionTemplateKey,
  ADMISSION_FIELD_CATALOGUE,
} from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';
import { IsRealDate } from '../../../common/decorators/is-real-date.decorator';
import { MONEY_MAX, toPaisa } from '../../../common/constants/money';

/** [Epic 71 D2] A round is one class. `class_section_id` stays accepted until Wave 4 so the
 * old admin screens keep working; exactly one of the two is required (checked in the service). */
export class CreateIntakeDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  @IsNotEmpty()
  @SanitizeText()
  title: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  class_id?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Legacy; the class is derived from it.' })
  @IsOptional()
  @IsUUID()
  class_section_id?: string;

  @ApiPropertyOptional({
    enum: Object.values(AdmissionTemplateKey),
    enumName: 'AdmissionTemplateKey',
  })
  @IsOptional()
  @IsEnum(AdmissionTemplateKey)
  template_key?: AdmissionTemplateKey;

  @ApiProperty()
  @IsInt()
  @Min(1)
  seat_count: number;

  @ApiProperty()
  @IsRealDate()
  open_date: string;

  @ApiProperty()
  @IsRealDate()
  close_date: string;

  @ApiProperty({ enum: Object.values(AdmissionDocumentType), isArray: true })
  @IsArray()
  @IsEnum(AdmissionDocumentType, { each: true })
  required_document_types: AdmissionDocumentType[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Admission-number prefix.' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^[A-Za-z0-9-]*$/)
  roll_prefix?: string | null;

  @ApiPropertyOptional({ description: 'Whole paisa; omit or null = no fee.', nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(toPaisa(MONEY_MAX))
  fee_amount_paisa?: number | null;

  @ApiPropertyOptional({ enum: Object.values(AdmissionPayMethod), isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsEnum(AdmissionPayMethod, { each: true })
  fee_pay_methods?: AdmissionPayMethod[];

  @ApiPropertyOptional({ type: String, isArray: true, description: 'Field catalogue keys.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ADMISSION_FIELD_CATALOGUE.length)
  @IsIn(ADMISSION_FIELD_CATALOGUE.map((f) => f.key), { each: true })
  form_fields?: string[];

  @ApiPropertyOptional({ type: String, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  publish_channels?: string[];

  @ApiPropertyOptional({ type: String, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tie_break?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  show_names_publicly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  widget_always_show?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  auto_activate_lists?: boolean;
}
