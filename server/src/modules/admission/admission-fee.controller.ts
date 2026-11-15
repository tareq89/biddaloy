import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ModuleKey, Permission } from '@biddaloy/shared';
import type { JwtPayload } from '@biddaloy/shared';
import { requestContext } from '../../common/request-context.util';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { RequiresModule } from '../auth/decorators/require-module.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AdmissionFeeService, type FeeActor } from './admission-fee.service';
import {
  FeeDecisionResponseDto,
  FeeProofListResponseDto,
  ListFeeProofsDto,
  SendBackFeeProofDto,
} from './dto/fee-decision.dto';

/** [71.G1.03] Staff verify manual fee proofs. */
@ApiTags('admission')
@ApiTenantAuth()
@Controller('admission/fee-proofs')
@RequiresModule(ModuleKey.admission)
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.ADMISSION_REVIEW)
export class AdmissionFeeController {
  constructor(private readonly fees: AdmissionFeeService) {}

  private actor(user: JwtPayload, request: Request): FeeActor {
    const ctx = requestContext(request);
    return { userId: user.sub, ip: ctx.ip, userAgent: ctx.userAgent };
  }

  @Get()
  @ApiOperation({ summary: 'List fee proofs (default AWAITING) with a seen_before warning count.' })
  @ApiOkResponse({ type: FeeProofListResponseDto })
  list(@Query() filters: ListFeeProofsDto, @CurrentTenant() tenant: { id: string }) {
    return this.fees.list(tenant.id, filters);
  }

  @Get(':id/attachment')
  @ApiOperation({ summary: 'Stream the proof file. Tenant-scoped; 404 across tenants.' })
  async attachment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const object = await this.fees.getAttachment(id, tenant.id);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    res.setHeader('Content-Type', object.contentType ?? 'application/octet-stream');
    return new StreamableFile(object.body);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Confirm the proof: applicant moves from FEE_PENDING to PENDING. A repeat is 409.',
  })
  @ApiOkResponse({ type: FeeDecisionResponseDto })
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.fees.confirm(id, tenant.id, this.actor(user, request));
  }

  @Post(':id/send-back')
  @HttpCode(200)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary:
      'Send the proof back with a reason; applicant stays FEE_PENDING and the guardian is told.',
  })
  @ApiOkResponse({ type: FeeDecisionResponseDto })
  sendBack(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendBackFeeProofDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.fees.sendBack(id, tenant.id, dto.reason, this.actor(user, request));
  }
}
