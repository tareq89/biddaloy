import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ApprovalScope } from '@biddaloy/shared';
import { RequireApproval } from '../../auth/decorators/require-approval.decorator';
import { ApprovalGuard } from '../../auth/guards/approval.guard';
import type { CockpitPrincipal } from '../../platform-identity/cockpit-principal';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import { XLSX_MIME } from '../../workbook/export/export.constants';
import { STRICT_RATE_LIMIT } from '../../../rate-limit';
import {
  ArchiveExportStatusDto,
  ArchiveSchoolDto,
  ArchiveSchoolResponseDto,
  StartArchiveExportResponseDto,
} from './dto/school-archive.dto';
import { SchoolArchiveService } from './school-archive.service';

type CockpitReq = Request & { user: CockpitPrincipal };
const ctx = (req: Request) => ({ ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null });

/** [Epic 99, D7, D29] Export a school's workbook, download it, then archive (suspend) it. */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/schools/:id/archive')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class SchoolArchiveController {
  constructor(private readonly archive: SchoolArchiveService) {}

  @Post('export')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({ summary: "Queue an export of this school's workbook. One running at a time." })
  startExport(@Param('id', ParseUUIDPipe) id: string): Promise<StartArchiveExportResponseDto> {
    return this.archive.startExport(id);
  }

  // Declared before `export/:jobId` so route matching stays unambiguous.
  @Get('export/:jobId/download')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Stream the finished workbook. Works after the school is suspended.' })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { body, filename, sizeBytes } = await this.archive.download(id, jobId);
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    if (sizeBytes) res.setHeader('Content-Length', sizeBytes);
    return new StreamableFile(body);
  }

  @Get('export/:jobId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Status and size of an export of this school.' })
  getExport(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ): Promise<ArchiveExportStatusDto> {
    return this.archive.getExport(id, jobId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_SCHOOL_CONTROL)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary: 'Suspend a school as archived once a finished export exists. Needs a step-up token.',
  })
  archiveSchool(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ArchiveSchoolDto,
    @Req() req: CockpitReq,
  ): Promise<ArchiveSchoolResponseDto> {
    return this.archive.archive(id, dto, req.user.sub, ctx(req));
  }
}
