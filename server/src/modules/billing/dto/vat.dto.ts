import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class VatSettingDto {
  @ApiProperty() enabled: boolean;
  @ApiProperty({ nullable: true, description: 'Percent with two decimals; null when off.' })
  rate_percent: number | null;
  @ApiProperty() label: string;
  @ApiProperty({ nullable: true }) registration: string | null;
}

export class UpdateVatDto {
  @ApiProperty() @IsBoolean() enabled: boolean;

  @ApiPropertyOptional({ minimum: 0.01, maximum: 50, description: 'Required when enabled.' })
  @ValidateIf((o: UpdateVatDto) => o.enabled === true)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(50)
  rate_percent?: number;

  @ApiPropertyOptional({ description: 'Omitted keeps the current label.' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 20)
  label?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Omitted keeps it; null or empty clears it.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(40)
  registration?: string | null;
}
