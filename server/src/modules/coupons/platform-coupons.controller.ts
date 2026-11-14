import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ApprovalScope } from '@biddaloy/shared';
import { RequireApproval } from '../auth/decorators/require-approval.decorator';
import { ApprovalGuard } from '../auth/guards/approval.guard';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { RequireTwoPerson } from '../platform-identity/approvals/require-two-person.decorator';
import { TwoPersonGuard } from '../platform-identity/approvals/two-person.guard';
import type { CockpitPrincipal } from '../platform-identity/cockpit-principal';
import { PlatformAdminGuard } from '../platform-identity/platform-admin.guard';
import { FailClosedWithoutRedis } from '../../common/rate-limit/app-throttler.guard';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import {
  CouponPageQueryDto,
  CreateCouponDto,
  CreateFreeCouponDto,
  UpdateCouponDto,
} from './dto/coupon.dto';
import { CouponsService, type Actor } from './coupons.service';

type CockpitReq = Request & { user: CockpitPrincipal };

const actorOf = (req: CockpitReq): Actor => ({
  userId: req.user.sub,
  ip: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

/** The interceptor lets a keyless request through, so the requirement lives here (Rule 25). */
function requireKey(key: string | undefined): void {
  if (key === undefined || key.trim() === '') {
    throw new BadRequestException('Idempotency-Key header is required to create a coupon.');
  }
}

/**
 * [Epic 100 #3870] Owner-side coupons. Cockpit token + platform owner on the whole class (Rule 29);
 * every write needs a step-up token. A 100 percent coupon is only made on `/free`, which also
 * needs the other owner (D29): with no second owner available it cannot be created.
 */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/coupons')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class PlatformCouponsController {
  constructor(
    private readonly coupons: CouponsService,
    private readonly twoPerson: TwoPersonGuard,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List coupons, newest first (keyset, limit <= 100).' })
  list(@Query() q: CouponPageQueryDto, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.coupons.list(q);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @FailClosedWithoutRedis()
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_COUPON)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary:
      'Create a coupon (percent 1-99 or fixed). Needs a step-up token and an `Idempotency-Key`; 409 COUPON_CODE_TAKEN for a different body on a taken code.',
  })
  create(
    @Body() dto: CreateCouponDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: CockpitReq,
  ) {
    requireKey(key);
    return this.coupons.create(dto, { free: false }, actorOf(req));
  }

  @Post('free')
  @HttpCode(HttpStatus.CREATED)
  @FailClosedWithoutRedis()
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(ApprovalGuard, TwoPersonGuard)
  @RequireApproval(ApprovalScope.PLATFORM_COUPON_FREE)
  @RequireTwoPerson(
    ApprovalScope.PLATFORM_COUPON_FREE,
    (req) => ({
      action: 'Create a free (100 percent) coupon',
      code: req.body?.code,
      percent: 100,
      scope: req.body?.scope ?? 'ALL',
    }),
    true,
  )
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary:
      'Create a 100 percent coupon. Needs a step-up token, the other owner and an `Idempotency-Key`.',
  })
  createFree(
    @Body() dto: CreateFreeCouponDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: CockpitReq,
  ) {
    requireKey(key);
    return this.coupons.create(dto as CreateCouponDto, { free: true }, actorOf(req));
  }

  @Patch(':id')
  @FailClosedWithoutRedis()
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_COUPON)
  @ApiOperation({
    summary:
      'Change active, ends_at, max_uses (not below the uses so far) or the school list. Code, kind and percent never change.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCouponDto,
    @Req() req: CockpitReq,
  ) {
    // A free coupon was approved by two owners, so editing it needs both again. The 100 percent
    // test reads the stored row (never the body); strict: one owner alone cannot widen it.
    if (await this.coupons.isFree(id)) {
      await this.twoPerson.enforce(
        req,
        ApprovalScope.PLATFORM_COUPON_FREE,
        { action: 'Change a free (100 percent) coupon', couponId: id },
        true,
      );
    }
    return this.coupons.update(id, dto, actorOf(req));
  }

  @Get(':id/usage')
  @ApiOperation({ summary: 'Uses, total discount and per-school rows (keyset, limit <= 100).' })
  usage(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: CouponPageQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.coupons.usage(id, q);
  }
}
