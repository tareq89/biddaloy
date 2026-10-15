import { ApiProperty } from '@nestjs/swagger';
import { PaymentMethod } from '@biddaloy/shared';

export const COLLECTION_METHOD_GROUPS = ['CASH', 'BKASH', 'BANK', 'OTHER_MOBILE'] as const;
export type CollectionMethodGroup = (typeof COLLECTION_METHOD_GROUPS)[number];

export class CollectionMethodFigure {
  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  payment_method: PaymentMethod;

  @ApiProperty({ description: 'Net received: SUCCESS payments minus reversals.' })
  net: number;

  @ApiProperty({ description: 'Payments received; reversal rows are not payments.' })
  payment_count: number;
}

export class CollectionGroupFigure {
  @ApiProperty({ enum: COLLECTION_METHOD_GROUPS, enumName: 'CollectionMethodGroup' })
  group: CollectionMethodGroup;

  @ApiProperty()
  net: number;

  @ApiProperty()
  payment_count: number;

  @ApiProperty({
    type: [CollectionMethodFigure],
    description: 'Methods that had activity, biggest net first.',
  })
  methods: CollectionMethodFigure[];
}

export class CollectionTodayWidgetDto {
  @ApiProperty({ example: '2026-10-07', description: 'School-local date, YYYY-MM-DD.' })
  date: string;

  @ApiProperty({
    description:
      'Net received from the start of the school-local day until now (reversals subtracted). Same filter as GET /reports/collections.',
  })
  net: number;

  @ApiProperty({ description: 'Payments received today; reversal rows are not counted.' })
  payment_count: number;

  @ApiProperty({ description: 'Net received yesterday, from its start to this time of day.' })
  yesterday_same_time_net: number;

  @ApiProperty({
    type: [CollectionGroupFigure],
    description: 'Always four groups, in the order CASH, BKASH, BANK, OTHER_MOBILE.',
  })
  groups: CollectionGroupFigure[];
}
