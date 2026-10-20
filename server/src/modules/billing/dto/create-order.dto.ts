import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

/** Rule 5: seats and months are bounded; the price is never sent, the server computes it. */
export class CreateOrderDto {
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

  @ApiProperty({
    format: 'uuid',
    description: 'Client-made; a retry with the same key returns the first order.',
  })
  @IsUUID()
  idempotency_key!: string;
}
