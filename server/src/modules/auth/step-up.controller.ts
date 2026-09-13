import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtPayload } from '@biddaloy/shared';
import { ContextGuard } from './guards/context.guard';
import { CurrentTenant } from './decorators/current-tenant.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { StepUpService, StepUpOtpRequestResult } from './step-up.service';
import { StepUpOtpRequestDto, StepUpVerifyDto, StepUpApprovalResponse } from './dto/step-up.dto';

/**
 * `POST /auth/step-up/*` (16.2.2) — turns an admin's credentials, typed on
 * the acting user's own screen, into a short-lived approval token for one
 * gated action. The caller (actor) must already be authenticated in a
 * tenant context; the approver is resolved by identifier inside
 * `StepUpService`, independent of who's calling.
 */
@ApiTags('auth')
@ApiTenantAuth()
@Controller('auth/step-up')
@UseGuards(AuthGuard('jwt'), ContextGuard)
export class StepUpController {
  constructor(private readonly stepUp: StepUpService) {}

  @Post('otp/request')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Sends a step-up OTP to an approver by identifier. Always 202 — never reveals whether the identifier resolves to an eligible approver.',
  })
  async requestOtp(
    @Body() dto: StepUpOtpRequestDto,
    @CurrentTenant() tenant: { id: string },
  ): Promise<StepUpOtpRequestResult> {
    return this.stepUp.requestOtp(dto.identifier, tenant.id);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Verifies an approver by OTP or password and issues a 300s approval token scoped to one gated action.',
  })
  async verify(
    @Body() dto: StepUpVerifyDto,
    @CurrentUser() user: JwtPayload,
    @CurrentTenant() tenant: { id: string },
    @Req() request: Request,
  ): Promise<StepUpApprovalResponse> {
    return this.stepUp.verify(dto, user.sub, tenant.id, requestContext(request));
  }
}
