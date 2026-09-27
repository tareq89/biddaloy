import { IsString, IsNotEmpty, IsUUID, IsInt, Min, IsDateString, IsArray, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AdmissionDocumentType } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

/** [27.3] Payload to open a new admission intake window for a class section. */
export class CreateIntakeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @SanitizeText()
  title: string;

  @ApiProperty()
  @IsUUID()
  class_section_id: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  seat_count: number;

  @ApiProperty()
  @IsDateString()
  open_date: string;

  @ApiProperty()
  @IsDateString()
  close_date: string;

  @ApiProperty({ enum: Object.values(AdmissionDocumentType), isArray: true })
  @IsArray()
  @IsEnum(AdmissionDocumentType, { each: true })
  required_document_types: AdmissionDocumentType[];
}
