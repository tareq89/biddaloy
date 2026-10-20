import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsInt,
  Min,
  IsArray,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AdmissionDocumentType } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';
import { IsRealDate } from '../../../common/decorators/is-real-date.decorator';

/** [27.3] Payload to open a new admission intake window for a class section. */
export class CreateIntakeDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
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
  @IsRealDate()
  open_date: string;

  @ApiProperty()
  @IsRealDate()
  close_date: string;

  @ApiProperty({ enum: Object.values(AdmissionDocumentType), isArray: true })
  @IsArray()
  @IsEnum(AdmissionDocumentType, { each: true })
  required_document_types: AdmissionDocumentType[];
}
