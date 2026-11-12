import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { ApprovalScope } from '@biddaloy/shared';
import { RequireApproval } from '../../auth/decorators/require-approval.decorator';
import { ApprovalGuard } from '../../auth/guards/approval.guard';
import { TwoPersonGuard } from '../../platform-identity/approvals/two-person.guard';
import type { CockpitPrincipal } from '../../platform-identity/cockpit-principal';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import { STRICT_RATE_LIMIT } from '../../../rate-limit';
import { PlatformSchoolDeleteService } from './platform-school-delete.service';

type CockpitReq = Request & { user: CockpitPrincipal };

export class DeleteSchoolDto {
  @ApiProperty({ minLength: 5, maxLength: 500 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

/**
 * [Epic 99 #3805, D5] Delete a school. Step-up token (ApprovalGuard) plus the other owner.
 * The other owner's approval is checked in the handler (as the announcements route does), after
 * the id and body are validated and the school is known to exist, so a bad call never files an
 * approval request.
 */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/schools')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class PlatformSchoolDeleteController {
  constructor(
    private readonly deletes: PlatformSchoolDeleteService,
    private readonly twoPerson: TwoPersonGuard,
  ) {}

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_DELETE_SCHOOL)
  @ApiOperation({
    summary:
      'Soft-delete a school: members signed out, Login as sessions ended, not revivable from the app. Needs a step-up token and the other owner.',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteSchoolDto,
    @Req() req: CockpitReq,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ id: string; deletedAt: Date }> {
    res.setHeader('Cache-Control', 'no-store');
    const school = await this.deletes.assertDeletable(id);
    await this.twoPerson.enforce(req, ApprovalScope.PLATFORM_DELETE_SCHOOL, {
      action: 'Delete a school',
      schoolId: school.id,
      name: school.name,
      slug: school.slug,
      reason: dto.reason,
    });
    return this.deletes.delete(id, dto.reason, req.user.sub, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
  }
}
