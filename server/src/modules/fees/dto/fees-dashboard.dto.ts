import { ApiProperty } from '@nestjs/swagger';
import { PaymentMethod, PaymentStatus } from '@biddaloy/shared';

/** One age band of outstanding dues. */
export class DuesAgeingBucketDto {
  @ApiProperty({ enum: ['0_30', '31_60', '60_PLUS'] })
  bucket: '0_30' | '31_60' | '60_PLUS';

  @ApiProperty({ description: 'Sum of open balances (total - paid - discount) in the band.' })
  amount: number;

  @ApiProperty({ description: 'round(amount / total_due * 100); 0 when total_due is 0.' })
  share_pct: number;
}

/** `GET /dashboard/widgets/dues-ageing` */
export class DuesAgeingWidgetDto {
  @ApiProperty({ example: '2026-10-07', description: 'School-local day the ages are measured on.' })
  as_of: string;

  @ApiProperty({
    description:
      'Sum of the three buckets. Equals the sum of total_due over every page of GET /fees/dues.',
  })
  total_due: number;

  @ApiProperty({
    type: [DuesAgeingBucketDto],
    description:
      'Always three, in order. Age = days past due_date; 0_30 includes not-yet-due fees and fees with no due date.',
  })
  buckets: DuesAgeingBucketDto[];
}

export class DuesByClassItemDto {
  @ApiProperty({ format: 'uuid' })
  class_id: string;

  @ApiProperty()
  class_name: string;

  @ApiProperty({ description: 'Open balance of the class.' })
  amount: number;

  @ApiProperty({ description: 'Distinct students with an open fee.' })
  student_count: number;
}

/** `GET /dashboard/widgets/dues-by-class` */
export class DuesByClassWidgetDto {
  @ApiProperty()
  total_due: number;

  @ApiProperty({ type: [DuesByClassItemDto], description: 'Largest amount first.' })
  classes: DuesByClassItemDto[];
}

/** `GET /dashboard/widgets/reminders-pending` */
export class RemindersPendingWidgetDto {
  @ApiProperty({
    description:
      'Flagged students (past reminder_threshold_date) with no non-FAILED reminder log since that date.',
  })
  student_count: number;

  @ApiProperty({ description: 'Distinct guardians of those students.' })
  guardian_count: number;

  @ApiProperty({ type: String, nullable: true, example: '2026-09-10' })
  oldest_threshold_date: string | null;
}

/** `GET /dashboard/widgets/fee-generation-status` */
export class FeeGenerationStatusWidgetDto {
  @ApiProperty({ example: '2026-10', description: 'School-local month, YYYY-MM.' })
  period: string;

  @ApiProperty({ description: 'At least one batch exists for the month.' })
  generated: boolean;

  @ApiProperty({ type: String, nullable: true, example: '2026-10-01T00:00:12.000Z' })
  first_generated_at: string | null;

  @ApiProperty({ description: 'Bills created by the month batches.' })
  bill_count: number;

  @ApiProperty()
  batch_count: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2026-11-01',
    description: 'Earliest next run of an active recurring schedule; null when none.',
  })
  next_scheduled_run: string | null;
}

export class RecentPaymentItemDto {
  @ApiProperty({ format: 'uuid' })
  payment_id: string;

  @ApiProperty({ type: String, nullable: true, description: 'Null if the student was deleted.' })
  student_name: string | null;

  @ApiProperty({ type: String, nullable: true })
  class_name: string | null;

  @ApiProperty({ type: String, nullable: true })
  section_name: string | null;

  @ApiProperty()
  amount: number;

  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  payment_method: PaymentMethod;

  @ApiProperty({ enum: PaymentStatus, enumName: 'PaymentStatus' })
  payment_status: PaymentStatus;

  @ApiProperty({ example: '2026-10-07T04:06:00.000Z' })
  payment_date: string;
}

/** `GET /dashboard/widgets/recent-payments` */
export class RecentPaymentsWidgetDto {
  @ApiProperty({ description: 'Sum of the SUCCESS rows shown; FAILED rows move no money.' })
  total_of_shown: number;

  @ApiProperty({ type: [RecentPaymentItemDto], description: 'Up to 5, newest first.' })
  items: RecentPaymentItemDto[];
}
