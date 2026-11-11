import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PlatformAccessGuard } from '../platform-identity/platform-access.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
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

/** `/platform/holiday-sets/*` — platform owners curate one holiday list per country/year (D10). */
@ApiTags('public-holidays')
@ApiTenantAuth()
@Controller('platform')
@UseGuards(AuthGuard(['jwt', 'cockpit-jwt']), PlatformAccessGuard)
export class PlatformHolidaySetsController {
  constructor(private readonly service: PublicHolidaysService) {}

  @Get('holiday-sets')
  @ApiOperation({ summary: 'List every platform public-holiday set. SUPER_ADMIN only.' })
  async listSets() {
    return this.service.listSets();
  }

  @Get('holiday-sets/:id')
  @ApiOperation({ summary: 'Get one platform public-holiday set. SUPER_ADMIN only.' })
  async getSet(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getSet(id);
  }

  @Post('holiday-sets/fetch')
  @ApiOperation({
    summary:
      'Fetch (or re-fetch) a country/year holiday set from an external source. SUPER_ADMIN only.',
  })
  async fetchSet(@Body() dto: FetchHolidaySetDto, @CurrentUser() user: { sub: string }) {
    return this.service.fetchIntoSet(dto.country, dto.year, user.sub);
  }

  @Put('holiday-sets/:id/entries')
  @ApiOperation({ summary: "Replace a holiday set's entries. SUPER_ADMIN only." })
  async updateEntries(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHolidaySetEntriesDto,
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.updateEntries(id, dto.entries, user.sub);
  }

  @Post('holiday-sets/:id/publish')
  @ApiOperation({ summary: 'Publish a holiday set for tenants to import from. SUPER_ADMIN only.' })
  async publish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { sub: string }) {
    return this.service.publish(id, user.sub);
  }

  @Post('holiday-sets/:id/unpublish')
  @ApiOperation({ summary: 'Unpublish a holiday set. SUPER_ADMIN only.' })
  async unpublish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { sub: string }) {
    return this.service.unpublish(id, user.sub);
  }
}

/**
 * `/calendar/public-holidays/*` — a tenant reads the published set for
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
  // Tenant
  // -------------------------------------------------------------------

  @Get('calendar/public-holidays')
  @RequirePermissions(Permission.CALENDAR_READ)
  @ApiOperation({
    summary: "Suggested holidays for this tenant's country/year, published sets only.",
  })
  async suggest(@Query() query: SuggestHolidaysQueryDto, @CurrentTenant() tenant: { id: string }) {
    return this.service.suggest(tenant.id, query.year);
  }

  @Post('calendar/public-holidays/add')
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
