import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { DuplexOrder, PrinterType } from '@biddaloy/shared';

const num = { maxDecimalPlaces: 2 } as const;

/**
 * Body for `POST /printers` (#1138). Margins default by type (D27): CARD 0,
 * OFFICE 5 — applied by the service, not here, so PATCH never resets them.
 */
export class CreatePrinterProfileDto {
  @ApiProperty()
  @IsString()
  @Length(1, 80)
  name: string;

  @ApiProperty({ enum: PrinterType })
  @IsEnum(PrinterType)
  printer_type: PrinterType;

  @ApiPropertyOptional({ minimum: 0, maximum: 25 })
  @IsOptional()
  @IsNumber(num)
  @Min(0)
  @Max(25)
  margin_top_mm?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 25 })
  @IsOptional()
  @IsNumber(num)
  @Min(0)
  @Max(25)
  margin_right_mm?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 25 })
  @IsOptional()
  @IsNumber(num)
  @Min(0)
  @Max(25)
  margin_bottom_mm?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 25 })
  @IsOptional()
  @IsNumber(num)
  @Min(0)
  @Max(25)
  margin_left_mm?: number;

  @ApiPropertyOptional({ minimum: -10, maximum: 10 })
  @IsOptional()
  @IsNumber(num)
  @Min(-10)
  @Max(10)
  offset_x_mm?: number;

  @ApiPropertyOptional({ minimum: -10, maximum: 10 })
  @IsOptional()
  @IsNumber(num)
  @Min(-10)
  @Max(10)
  offset_y_mm?: number;

  @ApiPropertyOptional({ minimum: 0.9, maximum: 1.1 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.9)
  @Max(1.1)
  scale?: number;

  @ApiPropertyOptional({ enum: DuplexOrder })
  @IsOptional()
  @IsEnum(DuplexOrder)
  duplex_order?: DuplexOrder;

  @ApiPropertyOptional({ minimum: 0, maximum: 10 })
  @IsOptional()
  @IsNumber(num)
  @Min(0)
  @Max(10)
  sheet_gap_mm?: number;
}

export class UpdatePrinterProfileDto extends PartialType(CreatePrinterProfileDto) {}
