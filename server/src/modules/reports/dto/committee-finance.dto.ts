import { ApiProperty } from '@nestjs/swagger';
import { CollectionMonthWidgetDto } from './collection-month-widget.dto';

/** Totals only: no student, guardian, invoice or collector field (COMMITTEE never sees a person). */
export class CommitteeFinanceMonthDto {
  @ApiProperty({
    example: '2026-10',
    description: 'Billing month (student_fees.period_start), YYYY-MM.',
  })
  month: string;

  @ApiProperty({
    description:
      'Accrual basis: total minus discount of non-deleted bills whose period_start is in the month, paid or not. Same rule as collection-month billed_for_month.',
  })
  billed: number;

  @ApiProperty({
    description:
      'Sum of paid_amount on those bills: the amount applied to bills, not physical cash (wallet credit spent on a bill counts).',
  })
  paid: number;

  @ApiProperty({
    description:
      'total minus paid minus discount over PENDING and PARTIALLY_PAID bills of the month: the dues rule of the fees dashboard.',
  })
  outstanding: number;
}

export class CommitteeFinanceDto {
  @ApiProperty({
    type: [CommitteeFinanceMonthDto],
    description:
      'Every month from the start of the current academic year (1 January when none is current) to the school-local current month, ascending, zero-filled. No future months.',
  })
  months: CommitteeFinanceMonthDto[];

  @ApiProperty({ description: 'Sum of outstanding over months.' })
  year_outstanding: number;

  @ApiProperty({
    type: CollectionMonthWidgetDto,
    description:
      'Cash basis (received) against accrual basis (billed_for_month); identical to the collection-month widget.',
  })
  current_month: CollectionMonthWidgetDto;
}
