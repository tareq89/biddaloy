import { Controller, Get, Param, ParseUUIDPipe, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import type { LoginAsCandidatesResponse } from '@biddaloy/shared';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import { LoginAsCandidatesQueryDto } from './dto/login-as-candidates.dto';
import { LoginAsCandidatesService } from './login-as-candidates.service';

/** [99.2.06] Who can the owner sign in as, for a school and a role. Platform route: no X-Tenant-ID. */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/schools/:id/login-as/candidates')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class LoginAsCandidatesController {
  constructor(private readonly candidates: LoginAsCandidatesService) {}

  @Get()
  @ApiOperation({ summary: 'People of one school and role that Login as can target.' })
  async list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: LoginAsCandidatesQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginAsCandidatesResponse> {
    res.setHeader('Cache-Control', 'no-store');
    return this.candidates.list(id, q.role, q.q, q.limit ?? 50);
  }
}
