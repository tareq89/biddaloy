import { Controller, Get, Header, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { CALENDAR_FEED_RATE_LIMIT } from '../../rate-limit';
import { CalendarFeedService } from './calendar-feed.service';
import { CalendarFeedDto } from './dto/calendar-feed.dto';

/**
 * Authenticated management of the caller's own ICS feed subscription
 * (17.4.1): `GET` returns the active token's URL (minting one on first
 * call); `POST .../regenerate` revokes it and issues a fresh one — the
 * only way to cut off a leaked link (D13). Same `@RequirePermissions`
 * shape `CalendarEventsController` uses; `@Roles` mirrors
 * `ROLE_PERMISSIONS`'s current `CALENDAR_READ` holders, spec-checked by
 * `permission-matrix.e2e-spec.ts`.
 */
@ApiTags('calendar-feed')
@ApiTenantAuth()
@Controller('calendar/feed')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class CalendarFeedController {
  constructor(private readonly service: CalendarFeedService) {}

  @Get()
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
    UserRole.EXECUTIVE,
  )
  @RequirePermissions(Permission.CALENDAR_READ)
  @ApiOperation({ summary: "Caller's active calendar feed URL — created on first call." })
  @ApiOkResponse({ type: CalendarFeedDto })
  async get(
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ): Promise<CalendarFeedDto> {
    return this.service.getOrCreate(tenant.id, user.sub);
  }

  @Post('regenerate')
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
    UserRole.EXECUTIVE,
  )
  @RequirePermissions(Permission.CALENDAR_READ)
  @ApiOperation({
    summary: 'Revokes the active calendar feed token and issues a new one.',
  })
  @ApiOkResponse({ type: CalendarFeedDto })
  async regenerate(
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ): Promise<CalendarFeedDto> {
    return this.service.regenerate(tenant.id, user.sub);
  }
}

/**
 * The public (token-authenticated) ICS feed route — no `AuthGuard`/
 * `ContextGuard`/`RolesGuard`/`PermissionsGuard` at all, same "no
 * principal to authenticate yet" shape `PublicInvoiceController` uses:
 * tenant and user come entirely from the token row
 * (`CalendarFeedService.render`), never from a header. `ThrottlerGuard`
 * still runs (global `APP_GUARD`) and falls back to per-IP bucketing.
 */
@ApiTags('calendar-feed')
@Controller('calendar/feed')
export class CalendarFeedPublicController {
  constructor(private readonly service: CalendarFeedService) {}

  @Get(':token.ics')
  @HttpCode(200)
  @Throttle({ default: CALENDAR_FEED_RATE_LIMIT })
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Cache-Control', 'private, max-age=900')
  @ApiOperation({
    summary:
      'Public ICS feed for a subscribed calendar token. No auth, no tenant header — 404 for an unknown, revoked, or deactivated-user token.',
  })
  async getFeed(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string | undefined> {
    const { body, etag } = await this.service.render(token);

    const ifNoneMatch = res.req.headers['if-none-match'];
    res.setHeader('ETag', etag);
    if (ifNoneMatch === etag) {
      res.status(304);
      return undefined;
    }

    return body;
  }
}
