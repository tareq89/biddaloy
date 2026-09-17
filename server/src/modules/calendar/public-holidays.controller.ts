import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { PublicHolidaysService } from './public-holidays.service';
import {
  BulkAddHolidaysDto,
  FetchHolidaySetDto,
  SuggestHolidaysQueryDto,
  UpdateHolidaySetEntriesDto,
} from './dto/public-holidays.dto';

/**
 * Two unrelated route families share this controller (17.2.4), which is
 * why it carries no fixed `@Controller()` prefix — each method spells its
 * own full path:
 *
 * - `/platform/holiday-sets/*` — SUPER_ADMIN curates one holiday list per
 *   country/year, fetched from an external source (D10: never called from
 *   a tenant route).
 * - `/calendar/public-holidays/*` — a tenant reads the published set for
 *   its own country/year and bulk-adds ticked entries as `HOLIDAY` events
 *   on its own calendar.
 */
@ApiTags('public-holidays')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class PublicHolidaysController {
  constructor(private readonly service: PublicHolidaysService) {}

  // -------------------------------------------------------------------
  // Platform (SUPER_ADMIN)
  // -------------------------------------------------------------------

  @Get('platform/holiday-sets')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'List every platform public-holiday set. SUPER_ADMIN only.' })
  async listSets() {
    return this.service.listSets();
  }

  @Get('platform/holiday-sets/:id')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get one platform public-holiday set. SUPER_ADMIN only.' })
  async getSet(@Param('id') id: string) {
    return this.service.getSet(id);
  }

  @Post('platform/holiday-sets/fetch')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'Fetch (or re-fetch) a country/year holiday set from an external source. SUPER_ADMIN only.',
  })
  async fetchSet(@Body() dto: FetchHolidaySetDto, @CurrentUser() user: { sub: string }) {
    return this.service.fetchIntoSet(dto.country, dto.year, user.sub);
  }

  @Put('platform/holiday-sets/:id/entries')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: "Replace a holiday set's entries. SUPER_ADMIN only." })
  async updateEntries(
    @Param('id') id: string,
    @Body() dto: UpdateHolidaySetEntriesDto,
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.updateEntries(id, dto.entries, user.sub);
  }

  @Post('platform/holiday-sets/:id/publish')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Publish a holiday set for tenants to import from. SUPER_ADMIN only.' })
  async publish(@Param('id') id: string, @CurrentUser() user: { sub: string }) {
    return this.service.publish(id, user.sub);
  }

  @Post('platform/holiday-sets/:id/unpublish')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Unpublish a holiday set. SUPER_ADMIN only.' })
  async unpublish(@Param('id') id: string, @CurrentUser() user: { sub: string }) {
    return this.service.unpublish(id, user.sub);
  }

  // -------------------------------------------------------------------
  // Tenant
  // -------------------------------------------------------------------

  @Get('calendar/public-holidays')
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
    summary: "Suggested holidays for this tenant's country/year, published sets only.",
  })
  async suggest(@Query() query: SuggestHolidaysQueryDto, @CurrentTenant() tenant: { id: string }) {
    return this.service.suggest(tenant.id, query.year);
  }

  @Post('calendar/public-holidays/add')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.CALENDAR_MANAGE)
  @ApiOperation({ summary: 'Bulk-add ticked suggested holidays as HOLIDAY events on this tenant.' })
  async bulkAdd(
    @Body() dto: BulkAddHolidaysDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.bulkAdd(tenant.id, user.sub, dto.entry_ids);
  }
}
