import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt } from 'class-validator';
import { SupportAccessMode } from '@biddaloy/shared';

/** [99.3.02] Response of GET /support-access/settings. Server-side: shared's DTO has no name or flag. */
export class SupportAccessSettingsResponseDto {
  @ApiProperty({ enum: SupportAccessMode }) mode!: SupportAccessMode;
  @ApiProperty({ nullable: true, type: String }) confirmedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) confirmedByName!: string | null;
  @ApiProperty() textVersion!: number;
  @ApiProperty() currentTextVersion!: number;
  @ApiProperty() needsConfirmation!: boolean;
}

export class ConfirmSupportAccessDto {
  @ApiProperty() @IsBoolean() allowed!: boolean;
  @ApiProperty() @IsInt() textVersion!: number;
}

export class ChangeSupportAccessModeDto {
  @ApiProperty({ enum: SupportAccessMode }) @IsEnum(SupportAccessMode) mode!: SupportAccessMode;
}
