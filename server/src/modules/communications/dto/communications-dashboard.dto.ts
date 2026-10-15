import { ApiProperty } from '@nestjs/swagger';

export class SmsBalanceWidgetDto {
  @ApiProperty({ enum: ['OFF', 'PLATFORM'] })
  metering: 'OFF' | 'PLATFORM';

  @ApiProperty({ description: 'SMS credits left to spend; 0 when metering is OFF' })
  available: number;

  @ApiProperty({ description: 'Credits held for queued sends; 0 when metering is OFF' })
  reserved: number;
}

export class FailedMessagesWindowDto {
  @ApiProperty({ example: '2026-10-01', description: 'First school day counted (inclusive)' })
  from: string;

  @ApiProperty({ example: '2026-10-07', description: 'Today in the school timezone' })
  to: string;
}

export class FailedMessagesWidgetDto {
  @ApiProperty({ description: 'SMS with status FAILED in the last 7 school days' })
  failed: number;

  @ApiProperty({ type: FailedMessagesWindowDto })
  window: FailedMessagesWindowDto;
}
