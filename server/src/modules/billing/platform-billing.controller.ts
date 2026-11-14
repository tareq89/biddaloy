import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApprovalScope, JwtPayload } from '@biddaloy/shared';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { FailClosedWithoutRedis } from '../../common/rate-limit/app-throttler.guard';
import { RequireApproval } from '../auth/decorators/require-approval.decorator';
import { ApprovalService } from '../auth/guards/approval.guard';
import { PlatformAccessGuard } from '../platform-identity/platform-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  GrantSeatsDto,
  ListPlatformSchoolsQueryDto,
  OfflinePaymentDto,
  OfflinePaymentResultDto,
  PlatformSchoolBillingDetailDto,
  PlatformSchoolBillingPageDto,
  RefundDto,
  RefundResultDto,
} from './dto/platform-billing.dto';
import { PlatformBillingService } from './platform-billing.service';
import { RefundService } from './refund.service';

/** Epic 49 W4: the platform SUPER_ADMIN's view of every school's seats, orders and payments. */
@ApiTags('platform')
@ApiBearerAuth('bearer')
@Controller('platform/billing')
@UseGuards(AuthGuard(['jwt', 'cockpit-jwt']), PlatformAccessGuard)
export class PlatformBillingController {
  constructor(
    private readonly service: PlatformBillingService,
    private readonly refunds: RefundService,
    private readonly approvals: ApprovalService,
  ) {}

  @Get('schools')
  @ApiOperation({
    summary: 'Every school with seats entitled / used, paid-until and pending orders.',
  })
  @ApiOkResponse({ type: PlatformSchoolBillingPageDto })
  list(@Query() query: ListPlatformSchoolsQueryDto) {
    return this.service.listSchools(query);
  }

  @Get('schools/:id')
  @ApiOperation({ summary: "One school's entitlement and its orders with the payment method." })
  @ApiOkResponse({ type: PlatformSchoolBillingDetailDto })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.schoolDetail(id);
  }

  @Post('orders/:id/offline-payment')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mark a PENDING order paid offline (bank / cash). Audited; a replay changes nothing.',
  })
  @ApiOkResponse({ type: OfflinePaymentResultDto })
  offlinePayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OfflinePaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.recordOfflinePayment(id, dto, user.sub);
  }

  @Post('sms-bundle-orders/:id/offline-payment')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Mark a PENDING_PAYMENT SMS package order paid offline. Audited; a replay changes nothing.',
  })
  @ApiOkResponse({ type: OfflinePaymentResultDto })
  offlineBundlePayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OfflinePaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.recordOfflineBundlePayment(id, dto, user.sub);
  }

  @Post('orders/:id/refund')
  @HttpCode(200)
  @FailClosedWithoutRedis()
  @RequireApproval(ApprovalScope.PLATFORM_REFUND)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary:
      'Refund a PAID seat order: entitlement is recomputed, the coupon use is kept. Needs an `Idempotency-Key` header. Money goes back through the bKash panel.',
  })
  @ApiOkResponse({ type: RefundResultDto })
  async refundSeatOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    // Rule 25: the interceptor is a no-op without the header, so the 400 is explicit.
    if (idempotencyKey === undefined) {
      throw new BadRequestException('Idempotency-Key header is required to refund.');
    }
    // Consumed here, after the idempotency interceptor, so a replay never needs a new token.
    const approval = await this.approvals.consume(
      req as unknown as Parameters<ApprovalService['consume']>[0],
      ApprovalScope.PLATFORM_REFUND,
    );
    return this.refunds.refundSeatOrder(id, dto.reason, user.sub, approval.approverId);
  }

  @Post('sms-bundle-orders/:id/refund')
  @HttpCode(200)
  @FailClosedWithoutRedis()
  @RequireApproval(ApprovalScope.PLATFORM_REFUND)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary:
      'Refund an ACTIVE SMS package order while no unit was used (409 BUNDLE_ALREADY_USED after). Needs an `Idempotency-Key` header. Money goes back through the bKash panel.',
  })
  @ApiOkResponse({ type: RefundResultDto })
  async refundBundleOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    if (idempotencyKey === undefined) {
      throw new BadRequestException('Idempotency-Key header is required to refund.');
    }
    // Consumed here, after the idempotency interceptor, so a replay never needs a new token.
    const approval = await this.approvals.consume(
      req as unknown as Parameters<ApprovalService['consume']>[0],
      ApprovalScope.PLATFORM_REFUND,
    );
    return this.refunds.refundBundleOrder(id, dto.reason, user.sub, approval.approverId);
  }

  @Post('schools/:id/grant')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Grant seats for free (a GRANT order, unit price 0). Audited with the reason; idempotent per key.',
  })
  @ApiOkResponse({ type: PlatformSchoolBillingDetailDto })
  grant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GrantSeatsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.grant(id, dto, user.sub);
  }
}
