import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ModuleKey, Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresModule } from '../auth/decorators/require-module.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { FailClosedWithoutRedis } from '../../common/rate-limit/app-throttler.guard';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import {
  BkashTestResponseDto,
  OnlinePaymentResultDto,
  StartOnlinePaymentDto,
  StartOnlinePaymentResponseDto,
} from './dto/online-payment.dto';
import { OnlinePaymentsService } from './online-payments.service';

type Tenant = { id: string; role: string };
type User = { sub: string };
const caller = (t: Tenant, u: User) => ({ tenantId: t.id, role: t.role, userId: u.sub });

/** Guardian portal: pay picked bills through bKash. PARENT only (PAYMENT_SUBMIT). */
@ApiTags('portal')
@ApiTenantAuth()
@Controller('portal/online-payments')
@RequiresModule(ModuleKey.fees)
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class OnlinePaymentsController {
  constructor(private readonly service: OnlinePaymentsService) {}

  /** Moves money: answers 503 while Redis (the rate limiter) is down (D19). */
  @Post()
  @FailClosedWithoutRedis()
  @UseInterceptors(IdempotencyInterceptor)
  @RequirePermissions(Permission.PAYMENT_SUBMIT)
  @ApiOperation({ summary: 'Start a bKash payment for picked bills; returns the bKash URL.' })
  @ApiCreatedResponse({ type: StartOnlinePaymentResponseDto })
  start(@Body() dto: StartOnlinePaymentDto, @CurrentTenant() t: Tenant, @CurrentUser() u: User) {
    return this.service.start(dto, caller(t, u));
  }

  @Get(':id')
  @RequirePermissions(Permission.PAYMENT_SUBMIT)
  @ApiOperation({ summary: 'How an online payment ended (family-scoped).' })
  @ApiOkResponse({ type: OnlinePaymentResultDto })
  result(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: User,
  ) {
    return this.service.result(id, caller(t, u));
  }
}

/** Admin: prove the saved bKash credentials work (token grant only). */
@ApiTags('settings')
@ApiTenantAuth()
@Controller('settings/payments/bkash')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class BkashTestController {
  constructor(private readonly service: OnlinePaymentsService) {}

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Test the saved bKash credentials; stamps lastTestOkAt on success.' })
  @ApiOkResponse({ type: BkashTestResponseDto })
  test(@CurrentTenant() t: Tenant) {
    return this.service.testConnection(t.id);
  }
}
