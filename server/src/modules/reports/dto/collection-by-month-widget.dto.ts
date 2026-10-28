import { ApiProperty } from '@nestjs/swagger';

export class CollectionMonthFigure {
  @ApiProperty({ example: 2026, description: 'Calendar year of this slot.' })
  year: number;

  @ApiProperty({ minimum: 1, maximum: 12 })
  month: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Amount applied to bills that school-local month (net of reversals, not physical cash); null for months after the current one.',
  })
  net: number | null;

  @ApiProperty()
  is_current: boolean;
}

export class CollectionByMonthWidgetDto {
  @ApiProperty({ example: 2026, description: 'School-local start year of the range.' })
  year: number;

  @ApiProperty({ description: 'Sum of the months up to and including the current one.' })
  year_to_date_net: number;

  @ApiProperty({
    description:
      'Amount applied to bills from day 1 of the current month until now (net of reversals, not physical cash).',
  })
  month_to_date_net: number;

  @ApiProperty({
    description:
      'Net received in the previous month from day 1 to the same day-of-month (clamped to its last day).',
  })
  previous_month_same_days_net: number;

  @ApiProperty({
    type: [CollectionMonthFigure],
    description: 'One slot per month of the current academic year (calendar year if none).',
  })
  months: CollectionMonthFigure[];
}
