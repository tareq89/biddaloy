import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { DAILY_LIMIT_MAX } from '@biddaloy/shared';

/** PUT body for both cockpit daily-limit routes. `null` removes this level's own value. */
export class UpdateDailyLimitsDto {
  @ApiPropertyOptional({ nullable: true, example: 2000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DAILY_LIMIT_MAX)
  sms?: number | null;

  @ApiPropertyOptional({ nullable: true, example: 2000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DAILY_LIMIT_MAX)
  email?: number | null;

  @ApiPropertyOptional({ nullable: true, example: 2000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DAILY_LIMIT_MAX)
  whatsapp?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsBoolean()
  showRemaining?: boolean | null;
}
