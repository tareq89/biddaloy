import { Controller, Get, Logger, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { STRICT_RATE_LIMIT } from '../../../rate-limit';
import { BkashService } from './bkash.service';

export class BkashPayResponseDto {
  @ApiProperty({ description: 'The bKash checkout page to send the admin to.' })
  bkash_url: string;
}

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined;

/**
 * Where bKash sends the browser back. Public by necessity (it is a redirect, no bearer token):
 * the credential is the paymentID, which is only believed after bKash itself confirms it
 * (BkashService.handleCallback). Listed in the route-guard allowlist; throttled STRICT.
 * No @FailClosedWithoutRedis: a gateway redirect must not answer 503 when the rate limiter is down.
 *
 * The query is read untyped on purpose: the global pipe rejects unknown params, and bKash may
 * append ones we do not know (e.g. `signature`). Only `paymentID` and `status` are used, and
 * both are length-checked here. Every failure is a 302 to the billing page with a generic error.
 */
@ApiTags('billing')
@Controller('billing/bkash')
export class BkashCallbackController {
  private readonly logger = new Logger(BkashCallbackController.name);

  constructor(private readonly bkash: BkashService) {}

  @Get('callback')
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary: 'bKash redirect target: verifies the payment, then returns to Settings.',
  })
  async callback(@Query() query: Record<string, unknown>, @Res() res: Response): Promise<void> {
    try {
      const paymentID = str(query.paymentID, 64);
      const status = str(query.status, 32);
      if (!paymentID || !status) throw new Error('bad callback query');
      const { orderId, outcome } = await this.bkash.handleCallback(paymentID, status);
      res.redirect(302, this.bkash.returnUrl(orderId, outcome));
    } catch (err) {
      this.logger.warn(`bKash callback refused: ${err instanceof Error ? err.message : 'error'}`);
      res.redirect(302, this.bkash.errorUrl());
    }
  }
}
