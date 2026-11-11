import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { PlatformAccessGuard } from '../platform-identity/platform-access.guard';
import {
  PlatformReportUsageDto,
  PlatformReportUsageQueryDto,
} from './delivery/dto/report-delivery.dto';
import { PlatformReportUsageService } from './platform-report-usage.service';

/**
 * [8.15.45] `GET /platform/reports/usage` (D24): platform SUPER_ADMIN only, same guard chain as the
 * other platform controllers (a school-local SUPER_ADMIN and every school role get 403). Aggregates
 * only; no student, guardian or money rows.
 */
@ApiTags('platform')
@ApiTenantAuth()
@Controller('platform/reports')
@UseGuards(AuthGuard(['jwt', 'cockpit-jwt']), PlatformAccessGuard)
export class PlatformReportUsageController {
  constructor(private readonly service: PlatformReportUsageService) {}

  @Get('usage')
  @ApiOperation({
    summary: 'Which reports are used and found useful, counts only. Platform SUPER_ADMIN only.',
  })
  @ApiOkResponse({ type: PlatformReportUsageDto })
  usage(@Query() query: PlatformReportUsageQueryDto): Promise<PlatformReportUsageDto> {
    return this.service.usage(query);
  }
}
