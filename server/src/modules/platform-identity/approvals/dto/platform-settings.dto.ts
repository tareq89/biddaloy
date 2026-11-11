import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class PlatformApprovalSettingDto {
  @ApiProperty({ description: 'Whether gated platform actions need the other owner.' })
  enabled: boolean;
}

export class UpdatePlatformApprovalSettingDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;
}
