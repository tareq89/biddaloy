import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PlatformAdminGuard } from '../platform-identity/platform-admin.guard';
import { RevenueQueryDto, type RevenueReport } from './dto/revenue.dto';
import { RevenueService } from './revenue.service';

/** [Epic 100 #3873, D10] Owner revenue for one month. Read-only; cockpit token only. */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/money')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class RevenueController {
  constructor(private readonly revenue: RevenueService) {}

  @Get('revenue')
  @ApiOperation({ summary: "One month's income, refunds, paying schools and not-renewed schools." })
  async get(
    @Query() q: RevenueQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RevenueReport | string> {
    if (q.format === 'csv') {
      const { month, body } = await this.revenue.csv(q.month);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="revenue-${month}.csv"`);
      return body;
    }
    return this.revenue.report(q.month, q.cursor, q.limit);
  }
}
