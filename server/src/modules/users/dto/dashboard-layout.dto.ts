import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import {
  DASHBOARD_LAYOUT_MAX_WIDGETS,
  DashboardWidgetKey,
  WIDGET_SIZES,
  type WidgetSize,
} from '@biddaloy/shared';

const WIDGET_KEYS = Object.values(DashboardWidgetKey);

export class DashboardLayoutItemDto {
  @ApiProperty({ enum: WIDGET_KEYS })
  @IsIn(WIDGET_KEYS)
  key: DashboardWidgetKey;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hidden?: boolean;

  @ApiPropertyOptional({ enum: WIDGET_SIZES })
  @IsOptional()
  @IsIn(WIDGET_SIZES)
  size?: WidgetSize;
}

export class DashboardLayoutDto {
  @ApiProperty({ type: [DashboardLayoutItemDto] })
  @IsArray()
  @ArrayMaxSize(DASHBOARD_LAYOUT_MAX_WIDGETS)
  @ArrayUnique((item: DashboardLayoutItemDto) => item?.key)
  @ValidateNested({ each: true })
  @Type(() => DashboardLayoutItemDto)
  widgets: DashboardLayoutItemDto[];
}
