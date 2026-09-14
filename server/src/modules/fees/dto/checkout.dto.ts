import {
  IsArray,
  IsNumber,
  IsOptional,
  IsUUID,
  ArrayMinSize,
  ArrayMaxSize,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { MAX_CART_STUDENTS } from '../checkout-cart.service';

/**
 * `GET /payments/cart` (16.4.1) — everything the Record Payment modal needs
 * for one or more students in a single call.
 *
 * `student_ids` arrives as a comma-joined query string (`?student_ids=a,b`),
 * the same shape used by `QueryLastRemindersDto`
 * (`server/src/modules/communications/dto/communications.dto.ts`).
 */
export class QueryCheckoutCartDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CART_STUDENTS)
  @IsUUID('4', { each: true })
  student_ids: string[];

  /** Amount to suggest an allocation for. Omitted → no `suggested` block. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;
}
