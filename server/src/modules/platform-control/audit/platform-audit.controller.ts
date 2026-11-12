import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import {
  ListLoginAsSessionsQueryDto,
  SearchPlatformAuditQueryDto,
  type LoginAsSessionItem,
  type Page,
  type PlatformAuditItem,
} from './dto/platform-audit.dto';
import { PlatformAuditService } from './platform-audit.service';

/** [Epic 99] Cockpit audit search and Login as log. Reads only: no step-up, no audit row. */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/audit')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class PlatformAuditController {
  constructor(private readonly audit: PlatformAuditService) {}

  @Get()
  @ApiOperation({ summary: 'Search audit rows across all schools (no old/new values).' })
  search(
    @Query() query: SearchPlatformAuditQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Page<PlatformAuditItem>> {
    res.setHeader('Cache-Control', 'no-store');
    return this.audit.search(query);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'The Login as session log across all schools.' })
  sessions(
    @Query() query: ListLoginAsSessionsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Page<LoginAsSessionItem>> {
    res.setHeader('Cache-Control', 'no-store');
    return this.audit.sessions(query);
  }
}
