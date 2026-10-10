import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsEnum } from 'class-validator';
import { AlertCategory } from '@biddaloy/shared';

/** [67.5.03] Strict: the global forbidNonWhitelisted pipe rejects any other key. */
export class UpdateNotificationPrefsDto {
  @ApiProperty({ enum: AlertCategory, isArray: true })
  @IsArray()
  @ArrayMaxSize(16)
  @ArrayUnique()
  @IsEnum(AlertCategory, { each: true })
  mutedCategories!: AlertCategory[];
}

export class QuietHoursDto {
  @ApiProperty({ example: '21:00' })
  start!: string;

  @ApiProperty({ example: '07:00' })
  end!: string;
}

export class NotificationPrefsDto {
  @ApiProperty({ enum: AlertCategory, isArray: true })
  mutedCategories!: AlertCategory[];

  @ApiProperty({ type: QuietHoursDto, description: "The school's setting; read-only here." })
  quietHours!: QuietHoursDto;
}
