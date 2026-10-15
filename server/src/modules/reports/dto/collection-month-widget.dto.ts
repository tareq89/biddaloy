import { ApiProperty } from '@nestjs/swagger';

/** One "same point of a month" figure set. */
export class CollectionMonthFigures {
  @ApiProperty({ example: '2026-09-07', description: 'Last day of the range, YYYY-MM-DD.' })
  as_of: string;

  @ApiProperty({
    description:
      'Amount applied to bills: net SUCCESS payments (reversals subtracted) dated day 1 to as_of, for any bill (not physical cash: wallet spend counts). Equals GET /reports/collections totals.net for the same range.',
  })
  received: number;

  @ApiProperty({
    description:
      'Accrual basis: total minus discount of non-deleted bills whose period_start is in the whole month, paid or not.',
  })
  billed_for_month: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'round(received / billed_for_month * 100); null when billed_for_month is 0. Different bases, so it can exceed 100 (arrears paid this month).',
  })
  received_pct: number | null;
}

export class CollectionMonthWidgetDto extends CollectionMonthFigures {
  @ApiProperty({ example: '2026-10', description: 'School-local month, YYYY-MM.' })
  month: string;

  @ApiProperty({ type: CollectionMonthFigures, description: 'Same day-of-month, previous month.' })
  last_month_same_point: CollectionMonthFigures;

  @ApiProperty({
    type: CollectionMonthFigures,
    nullable: true,
    description:
      'Same day-of-month, same month last year; null when it had no bills and no net cash.',
  })
  last_year_same_point: CollectionMonthFigures | null;
}
