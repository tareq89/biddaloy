import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApprovalScope } from '@biddaloy/shared';
import { RequireApproval } from '../auth/decorators/require-approval.decorator';
import { ApprovalGuard } from '../auth/guards/approval.guard';
import type { CockpitPrincipal } from '../platform-identity/cockpit-principal';
import { PlatformAdminGuard } from '../platform-identity/platform-admin.guard';
import {
  AssignPlanDto,
  CreatePlanDto,
  ListPlansQueryDto,
  PlanDto,
  PlanPriceDto,
  UpdatePlanDto,
} from './dto/plan.dto';
import { PlansService, type PlanActor } from './plans.service';

type CockpitReq = Request & { user: CockpitPrincipal; approval?: { approverId: string } };
const actor = (req: CockpitReq): PlanActor => ({
  userId: req.user.sub,
  approverId: req.approval?.approverId,
  ip: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

/** [100.3.02] Plans catalog and a school's plan. No DELETE: orders and schools reference plans. */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class PlatformPlansController {
  constructor(private readonly plans: PlansService) {}

  @Get('plans')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'All plans, at most 100.' })
  list(@Query() q: ListPlansQueryDto): Promise<PlanDto[]> {
    return this.plans.list(q.limit);
  }

  @Post('plans')
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_PLAN)
  @ApiOperation({ summary: 'Create a plan. Needs a step-up token.' })
  create(@Body() dto: CreatePlanDto, @Req() req: CockpitReq): Promise<PlanDto> {
    return this.plans.create(dto, actor(req));
  }

  @Patch('plans/:id')
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_PLAN)
  @ApiOperation({ summary: 'Edit or deactivate a plan. Needs a step-up token.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
    @Req() req: CockpitReq,
  ): Promise<PlanDto> {
    return this.plans.update(id, dto, actor(req));
  }

  @Post('plans/:id/make-default')
  @HttpCode(200)
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_PLAN)
  @ApiOperation({ summary: 'Make an active plan the default. Needs a step-up token.' })
  makeDefault(@Param('id', ParseUUIDPipe) id: string, @Req() req: CockpitReq): Promise<PlanDto> {
    return this.plans.makeDefault(id, actor(req));
  }

  @Post('billing/schools/:id/plan')
  @HttpCode(200)
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_PLAN)
  @ApiOperation({ summary: 'Move a school to an active plan. Prices only its next order.' })
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignPlanDto,
    @Req() req: CockpitReq,
  ): Promise<PlanPriceDto> {
    return this.plans.assign(id, dto, actor(req));
  }
}
