import {
  Controller,
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
import { Response } from 'express';
import { ApprovalScope } from '@biddaloy/shared';
import { ApprovalGuard } from '../../auth/guards/approval.guard';
import { RequireApproval } from '../../auth/decorators/require-approval.decorator';
import type { CockpitPrincipal } from '../cockpit-principal';
import { PlatformAdminGuard } from '../platform-admin.guard';
import { ListPlatformApprovalsQueryDto, PlatformApprovalRow } from './dto/platform-approvals.dto';
import { PlatformApprovalsService } from './platform-approvals.service';

/** [Epic 98] Both owners see the list; the OTHER owner decides, confirming with an authenticator code. */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/approvals')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class PlatformApprovalsController {
  constructor(private readonly approvals: PlatformApprovalsService) {}

  @Get()
  @ApiOperation({ summary: 'Approval requests, newest first.' })
  async list(
    @Query() q: ListPlatformApprovalsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PlatformApprovalRow[]> {
    res.setHeader('Cache-Control', 'no-store');
    return this.approvals.list(q.status, q.limit);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_APPROVAL_DECIDE)
  @ApiOperation({ summary: "Approve another owner's request. Needs a step-up token." })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: CockpitPrincipal },
  ): Promise<void> {
    await this.approvals.decide(id, req.user.sub, 'approve');
  }

  @Post(':id/deny')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_APPROVAL_DECIDE)
  @ApiOperation({ summary: "Deny another owner's request. Needs a step-up token." })
  async deny(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: CockpitPrincipal },
  ): Promise<void> {
    await this.approvals.decide(id, req.user.sub, 'deny');
  }
}
