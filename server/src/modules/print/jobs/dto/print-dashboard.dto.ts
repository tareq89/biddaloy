import { ApiProperty } from '@nestjs/swagger';
import { QueueKindCountDto } from './print-history.dto';

/** `GET /dashboard/widgets/print-queue`: the to-print queue's counts, nothing else (no exams, no names). */
export class PrintQueueWidgetDto {
  @ApiProperty() total: number;
  @ApiProperty({ type: [QueueKindCountDto] }) by_kind: QueueKindCountDto[];
}
