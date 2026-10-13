import { ApiProperty } from '@nestjs/swagger';

export class PlatformAlertItemDto {
  @ApiProperty({ enum: ['REDIS_DOWN'] })
  kind: 'REDIS_DOWN';

  @ApiProperty({ description: 'ISO timestamp the alert opened.' })
  opened_at: string;
}

/** Open platform alerts. Empty when nothing is wrong. */
export class PlatformAlertsDto {
  @ApiProperty({ type: [PlatformAlertItemDto] })
  alerts: PlatformAlertItemDto[];
}
