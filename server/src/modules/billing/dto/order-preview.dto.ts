import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Same bounds as CreateOrderDto; no idempotency key because nothing is written. */
export class OrderPreviewDto {
  @ApiProperty({ minimum: 1, maximum: 100000 })
  @IsInt()
  @Min(1)
  @Max(100000)
  seats!: number;

  @ApiProperty({ minimum: 1, maximum: 24 })
  @IsInt()
  @Min(1)
  @Max(24)
  months!: number;

  @ApiProperty({ required: false, maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  coupon_code?: string;
}
