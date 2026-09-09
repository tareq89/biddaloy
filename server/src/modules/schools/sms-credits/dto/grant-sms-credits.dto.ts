import { IsInt, IsNotEmpty, IsString, Length, Max, Min, NotEquals } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Body for `POST /schools/:id/sms-credits` (#550). `units` signs the
 * movement: positive routes to `SmsCreditService.grant`, negative to
 * `adjust` — there's no separate `kind` field, the sign says it all.
 * `idempotency_key` is the caller's, not generated server-side, so a
 * retried request (double-click, client timeout+retry) is safely a no-op
 * rather than a double grant. */
export class GrantSmsCreditsDto {
  @ApiProperty({
    description: 'Signed credit delta. Positive = grant, negative = adjust.',
    minimum: -1_000_000,
    maximum: 1_000_000,
  })
  @IsInt()
  @NotEquals(0)
  @Min(-1_000_000)
  @Max(1_000_000)
  units: number;

  @ApiProperty({ minLength: 5, maxLength: 500 })
  @IsString()
  @Length(5, 500)
  reason: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  idempotency_key: string;
}
