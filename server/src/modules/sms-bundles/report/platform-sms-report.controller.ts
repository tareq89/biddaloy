import { Controller, Get, Header, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import { SmsStateReportDto, SmsStateReportQueryDto } from './dto/sms-state-report.dto';
import { SmsStateReportService } from './sms-state-report.service';

/**
 * [100.2.09] The owner's read-only SMS state: bought, sold, used, revenue, margin, what to do.
 * Cross-school by design; the only caller class is a platform owner (cockpit session). No
 * step-up: nothing here changes state.
 */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/money/sms')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class PlatformSmsReportController {
  constructor(private readonly report: SmsStateReportService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'SMS state report as JSON, or per-school CSV with format=csv.' })
  async get(
    @Query() q: SmsStateReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SmsStateReportDto | StreamableFile> {
    if (q.format !== 'csv') return this.report.getReport(q.limit, q.after);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sms-state-report.csv"',
    });
    return new StreamableFile(Buffer.from(this.report.toCsv(await this.report.csvRows()), 'utf-8'));
  }
}
