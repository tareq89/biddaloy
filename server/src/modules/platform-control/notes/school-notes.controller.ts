import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { CockpitPrincipal } from '../../platform-identity/cockpit-principal';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import {
  AddSchoolNoteDto,
  ListSchoolNotesQueryDto,
  SchoolNoteResponseDto,
} from './dto/school-notes.dto';
import { SchoolNotesService } from './school-notes.service';

type CockpitReq = Request & { user: CockpitPrincipal };
const ctx = (req: Request) => ({ ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null });

/** [Epic 99, D7, D29] Owner notes on a school. Cockpit token only; no step-up. */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/schools/:id/notes')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class SchoolNotesController {
  constructor(private readonly notes: SchoolNotesService) {}

  @Get()
  @ApiOperation({ summary: 'List a school’s private notes, newest first.' })
  async list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: ListSchoolNotesQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SchoolNoteResponseDto[]> {
    res.setHeader('Cache-Control', 'no-store');
    return this.notes.list(id, q.limit);
  }

  // No Idempotency-Key: owner-only private note, a duplicate is harmless and deletable.
  @Post()
  @ApiOperation({ summary: 'Add a private note to a school.' })
  async add(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddSchoolNoteDto,
    @Req() req: CockpitReq,
  ): Promise<SchoolNoteResponseDto> {
    return this.notes.add(id, dto.text, req.user.sub, ctx(req));
  }

  @Delete(':noteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove one note.' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Req() req: CockpitReq,
  ): Promise<void> {
    await this.notes.remove(id, noteId, req.user.sub, ctx(req));
  }
}
