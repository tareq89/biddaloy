import { IsEnum, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { AdmissionStageKind } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

export class CreateStageDto {
  @ApiProperty({ enum: Object.values(AdmissionStageKind), enumName: 'AdmissionStageKind' })
  @IsEnum(AdmissionStageKind)
  kind: AdmissionStageKind;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @SanitizeText()
  title?: string | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class UpdateStageDto extends PartialType(CreateStageDto) {}
