import { BadRequestException, Controller, Get, Logger, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import { OnlinePaymentsService } from './online-payments.service';

/**
 * Where bKash sends the guardian's browser back. Public by necessity (a redirect carries no
 * bearer token): the paymentID is only believed after bKash itself confirms it
 * (OnlinePaymentsService.handleCallback). Allowlisted in the route guard; throttled STRICT.
 * No @FailClosedWithoutRedis: a gateway redirect must work while the rate limiter is down.
 *
 * The query is read untyped on purpose (bKash may append params the global pipe would reject);
 * only `paymentID` and `status` are used. A missing or malformed paymentID is a 400; anything
 * else is a 302 to the result page that never says why (Rule 23).
 */
@ApiTags('portal')
@Controller('online-payments')
export class OnlinePaymentsPublicController {
  private readonly logger = new Logger(OnlinePaymentsPublicController.name);

  constructor(private readonly service: OnlinePaymentsService) {}

  @Get('callback')
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({ summary: 'bKash redirect target: verifies the payment, then shows the result.' })
  async callback(@Query() query: Record<string, unknown>, @Res() res: Response): Promise<void> {
    let id: string | undefined;
    try {
      id = await this.service.handleCallback(query.paymentID, query.status);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`bKash callback failed: ${err instanceof Error ? err.message : 'error'}`);
    }
    res.redirect(302, this.service.resultUrl(id));
  }
}
