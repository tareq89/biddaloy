import { Controller, Get, Param, ParseUUIDPipe, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import { SchoolOverviewDto } from './dto/school-overview.dto';
import { SchoolOverviewService } from './school-overview.service';

/** [Epic 99, D7, D29] The 360 page's top block. Cockpit token only; read-only, no step-up. */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/schools/:id/overview')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class SchoolOverviewController {
  constructor(private readonly overview: SchoolOverviewService) {}

  @Get()
  @ApiOperation({
    summary:
      'One call for the school 360 header: admins, people, SMS, files, alerts, audit, notes.',
  })
  @ApiOkResponse({ type: SchoolOverviewDto })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SchoolOverviewDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.overview.get(id);
  }
}
