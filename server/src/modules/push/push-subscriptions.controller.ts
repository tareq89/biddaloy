import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { PushConfigService } from './push-config';
import { PushSubscriptionsService } from './push-subscriptions.service';
import {
  CreatePushSubscriptionDto,
  PushPublicKeyResponseDto,
  PushSubscriptionResponseDto,
} from './dto/push-subscription.dto';

const ALL_ROLES = [
  UserRole.ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.EXECUTIVE,
  UserRole.TEACHER,
  UserRole.PARENT,
  UserRole.STUDENT,
];

function toResponse(row: {
  id: string;
  user_agent: string | null;
  created_at: Date;
  last_used_at: Date | null;
}): PushSubscriptionResponseDto {
  return {
    id: row.id,
    user_agent: row.user_agent,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
  };
}

/**
 * A signed-in user's own Web Push subscriptions — never anyone else's.
 * `@Roles(ALL_ROLES)` intentionally admits every tenant role: this is
 * identity-scoped (ownership comes from the JWT `sub`, like `GET
 * users/me`), not capability-gated, so there is no `@RequirePermissions()`
 * — see `IDENTITY_SCOPED` in `permission-matrix.e2e-spec.ts`, which this
 * controller's routes must be added to.
 */
@ApiTags('push')
@ApiTenantAuth()
@Controller('me/push')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class PushSubscriptionsController {
  constructor(
    private readonly pushConfig: PushConfigService,
    private readonly subscriptions: PushSubscriptionsService,
  ) {}

  @Get('public-key')
  @Roles(...ALL_ROLES)
  @ApiOperation({
    summary:
      'Whether push is enabled for this deployment, and the VAPID public key to subscribe with.',
  })
  @ApiOkResponse({ type: PushPublicKeyResponseDto })
  getPublicKey(): PushPublicKeyResponseDto {
    const enabled = this.pushConfig.isPushEnabled();
    return { enabled, public_key: enabled ? this.pushConfig.getVapidPublicKey() : null };
  }

  @Post('subscriptions')
  @HttpCode(HttpStatus.CREATED)
  @Roles(...ALL_ROLES)
  @ApiOperation({
    summary: "Registers (or re-owns) the caller's browser PushSubscription. Upserts by endpoint.",
  })
  @ApiOkResponse({ type: PushSubscriptionResponseDto })
  async subscribe(
    @Body() dto: CreatePushSubscriptionDto,
    @CurrentUser() user: { sub: string },
    @CurrentTenant() tenant: { id: string; role: string },
    @Req() req: Request,
  ): Promise<PushSubscriptionResponseDto> {
    const { userAgent } = requestContext(req);
    const row = await this.subscriptions.subscribe(user.sub, tenant.id, dto, userAgent);
    return toResponse(row);
  }

  @Get('subscriptions')
  @Roles(...ALL_ROLES)
  @ApiOperation({
    summary: "Lists the caller's own push subscriptions. Never returns endpoint/keys.",
  })
  @ApiOkResponse({ type: PushSubscriptionResponseDto, isArray: true })
  async list(
    @CurrentUser() user: { sub: string },
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<PushSubscriptionResponseDto[]> {
    const rows = await this.subscriptions.list(user.sub, tenant.id);
    return rows.map(toResponse);
  }

  @Delete('subscriptions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(...ALL_ROLES)
  @ApiOperation({
    summary: "Deletes one of the caller's own push subscriptions. 404 if it isn't theirs.",
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { sub: string },
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<void> {
    await this.subscriptions.remove(id, user.sub, tenant.id);
  }

  @Delete('subscriptions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(...ALL_ROLES)
  @ApiOperation({
    summary: "Deletes all of the caller's own push subscriptions (opt out of push entirely).",
  })
  async removeAll(
    @CurrentUser() user: { sub: string },
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<void> {
    await this.subscriptions.removeAll(user.sub, tenant.id);
  }
}
