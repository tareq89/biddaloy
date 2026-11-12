import { Body, Controller, Param, ParseUUIDPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ApprovalScope } from '@biddaloy/shared';
import { RequireApproval } from '../../auth/decorators/require-approval.decorator';
import { ApprovalGuard } from '../../auth/guards/approval.guard';
import type { CockpitPrincipal } from '../../platform-identity/cockpit-principal';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import { STRICT_RATE_LIMIT } from '../../../rate-limit';
import { SchoolRenameDto, SchoolRenameResponseDto } from './dto/school-rename.dto';
import { SchoolRenameService } from './school-rename.service';

type CockpitReq = Request & { user: CockpitPrincipal };
const ctx = (req: Request) => ({ ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null });

/**
 * [Epic 99, D7, D29] Rename a school. Needs a step-up token. No Idempotency-Key: setting the same
 * name twice is a no-op (the second call changes nothing and writes no audit row).
 */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/schools/:id/name')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard, ApprovalGuard)
@RequireApproval(ApprovalScope.PLATFORM_SCHOOL_CONTROL)
@Throttle({ default: STRICT_RATE_LIMIT })
export class SchoolRenameController {
  constructor(private readonly rename: SchoolRenameService) {}

  @Patch()
  @ApiOperation({ summary: 'Rename a school (name, name_bn). Needs a step-up token.' })
  @ApiOkResponse({ type: SchoolRenameResponseDto })
  async patch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SchoolRenameDto,
    @Req() req: CockpitReq,
  ): Promise<SchoolRenameResponseDto> {
    return this.rename.rename(id, dto, req.user.sub, ctx(req));
  }
}
