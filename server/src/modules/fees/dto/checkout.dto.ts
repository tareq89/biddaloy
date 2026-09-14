import {
  IsArray,
  IsNumber,
  IsOptional,
  IsUUID,
  IsEnum,
  IsIn,
  IsString,
  IsDateString,
  ArrayMinSize,
  ArrayMaxSize,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PaymentMethod } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';
import { MAX_CART_STUDENTS } from '../checkout-cart.service';
import { Payment } from '../entities/payment.entity';

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

/** A single bill this checkout applies money to (16.4.2). */
export class CheckoutLineDto {
  @IsUUID()
  student_fee_id: string;

  /** Amount allocated to this bill's `paid_amount` — not net of
   * `one_off_discount`, which is tracked (and settles the bill) separately. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  /** One-off discount granted on this specific bill at checkout. Any line
   * with `one_off_discount > 0` requires the `fees.discount` approval scope
   * — one token covers every discounted line in the whole checkout. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  one_off_discount?: number = 0;
}

const MAX_CHECKOUT_LINES = 200;

/** `POST /payments/checkout` (16.4.2) — records one payment across one or
 * more students' bills, applying wallet credit and cash tendered/change in
 * a single locked, idempotent transaction. */
export class CheckoutDto {
  /** Client-supplied key so a retried checkout (flaky network, a doubled
   * tap) never records the payment twice — a repeat with the same key
   * returns the already-recorded payment instead. */
  @IsUUID()
  idempotency_key: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CHECKOUT_LINES)
  @ValidateNested({ each: true })
  @Type(() => CheckoutLineDto)
  lines: CheckoutLineDto[];

  @IsEnum(PaymentMethod)
  payment_method: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  transaction_reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @SanitizeText()
  remarks?: string;

  /** Cash actually handed over. Omitted → assumed to be exactly what's
   * owed after wallet credit, i.e. no change. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  tendered_amount?: number;

  /** Wallet credit to apply, drawn from the first line's student's wallet.
   * Must not exceed that wallet's balance. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  wallet_use?: number;

  /** What happens to any change left over once every line and the wallet
   * draw are covered by `tendered_amount`. Defaults to handing it back. */
  @IsOptional()
  @IsIn(['RETURN', 'TO_WALLET'])
  change_handling?: 'RETURN' | 'TO_WALLET' = 'RETURN';

  @IsOptional()
  @IsDateString()
  payment_date?: string;
}

/** Response shape for `POST /payments/checkout`. */
export class CheckoutResultDto {
  payment: Payment;
  invoice_id: string;
  invoice_number: string;
  change_amount: number;
  wallet_balance_after: number;
}
