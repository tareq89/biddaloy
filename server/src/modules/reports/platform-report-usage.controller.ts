import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformAccessGuard } from '../platform-identity/platform-access.guard';
import {
  PlatformReportUsageDto,
  PlatformReportUsageQueryDto,
} from './delivery/dto/report-delivery.dto';
import { PlatformReportUsageService } from './platform-report-usage.service';

/**
 * [8.15.45] `GET /platform/reports/usage` (D24): platform Cockpit owners only, same guard chain as the
 * other platform controllers (a school-local SUPER_ADMIN and every school role get 403). Aggregates
 * only; no student, guardian or money rows.
 */
@ApiTags('platform')
@ApiBearerAuth('bearer')
@Controller('platform/reports')
@UseGuards(AuthGuard(['jwt', 'cockpit-jwt']), PlatformAccessGuard)
export class PlatformReportUsageController {
  constructor(private readonly service: PlatformReportUsageService) {}

  @Get('usage')
  @ApiOperation({
    summary: 'Which reports are used and found useful, counts only. Cockpit owners only.',
  })
  @ApiOkResponse({ type: PlatformReportUsageDto })
  usage(@Query() query: PlatformReportUsageQueryDto): Promise<PlatformReportUsageDto> {
    return this.service.usage(query);
  }
}
