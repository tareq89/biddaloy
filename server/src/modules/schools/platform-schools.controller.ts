import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtPayload } from '@biddaloy/shared';
import { PlatformAccessGuard } from '../platform-identity/platform-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedOnly } from '../auth/decorators/authenticated-only.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { SchoolsService } from './schools.service';
import { ListSchoolsQueryDto, SchoolListItemDto } from './dto/school-list-item.dto';
import { UpdateSchoolStatusDto } from './dto/update-school-status.dto';
import { ReviveSchoolDto } from './dto/revive-school.dto';

/**
 * [Epic 98 #3752] The platform-only school routes, moved from `/schools` to `/platform/schools`.
 * No tenant header: a cockpit token has none. Until the Wave 5 cutover either authority passes.
 */
@ApiTags('schools')
@ApiTenantAuth()
@Controller('platform/schools')
@UseGuards(AuthGuard(['jwt', 'cockpit-jwt']), PlatformAccessGuard)
export class PlatformSchoolsController {
  constructor(private readonly schools: SchoolsService) {}

  @AuthenticatedOnly()
  @Get()
  @ApiOperation({
    summary:
      "List every school (id, name, slug, status, created_at) — #8.7.13's super-admin school picker, extended by #533's platform schools list. An ADMIN doesn't get this route at all; they already know their one school from their own tenant context.",
  })
  @ApiOkResponse({ type: SchoolListItemDto, isArray: true })
  async findAll(@Query() query: ListSchoolsQueryDto) {
    return this.schools.findAll(query.trial);
  }

  @AuthenticatedOnly()
  @Get(':id/stats')
  @ApiOperation({
    summary:
      'Five cheap platform metrics for a school (#532) — active users, students, queued/recently-failed communications, and last activity. SUPER_ADMIN only.',
  })
  async getStats(@Param('id', ParseUUIDPipe) id: string) {
    return this.schools.getStats(id);
  }

  @AuthenticatedOnly()
  @Patch(':id/status')
  @ApiOperation({
    summary:
      "Suspend or reactivate a school (#530). SUPER_ADMIN only. A mandatory reason is audited (SUSPEND/REACTIVATE), and the tenant status cache is invalidated so the change takes effect on the school's very next request.",
  })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSchoolStatusDto,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.schools.updateStatus(id, dto, user.sub, requestContext(request));
  }

  @AuthenticatedOnly()
  @Post(':id/revive')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Revive a school paused or soft-deleted for having no students (Epic 49 D5). Platform SUPER_ADMIN only; within 90 days of the soft delete; audited REACTIVATE.',
  })
  async revive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviveSchoolDto,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.schools.revive(id, dto, user.sub, requestContext(request));
  }
}
