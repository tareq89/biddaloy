import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PRINT_BATCH_CEILING, PrintContextType } from '@biddaloy/shared';

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
