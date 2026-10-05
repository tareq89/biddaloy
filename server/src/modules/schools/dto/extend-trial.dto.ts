import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/** Body for `PATCH /schools/:id/trial` [13.3.4]. */
export class ExtendTrialDto {
  @ApiProperty({ minimum: 1, maximum: 365 })
  @IsInt()
  @Min(1)
  @Max(365)
  days: number;

  /** Omitted = keep the current limit. The service rejects a value below the current ACTIVE students. */
  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  seat_limit?: number;

  @ApiProperty({ minLength: 10, maxLength: 500 })
  @IsString()
  @Length(10, 500)
  reason: string;
}
