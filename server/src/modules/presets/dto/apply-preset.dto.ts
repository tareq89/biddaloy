import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/** Body for `POST /presets/apply`. Snake_case on the wire; the service maps it to PresetApplyOptions. */
export class ApplyPresetDto {
  @ApiProperty({ example: 'bd/nctb' })
  @IsString()
  preset_id: string;

  @ApiProperty({ minimum: 2000, maximum: 2100, example: 2026 })
  @IsInt()
  @Min(2000)
  @Max(2100)
  start_year: number;

  @ApiProperty({ type: [String], example: ['PRIMARY'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  stages: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Required (>=1) when the pack has versions; forbidden otherwise.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  versions?: string[];
}
