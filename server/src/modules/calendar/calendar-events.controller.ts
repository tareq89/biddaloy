import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { CalendarEventsService } from './calendar-events.service';
import {
  CalendarEventListResponseDto,
  CalendarEventResponseDto,
  CreateCalendarEventDto,
  FamilyCalendarEventDto,
  QueryCalendarEventsDto,
  UpdateCalendarEventDto,
} from './dto/calendar-events.dto';
import { CalendarEventWithClassIds } from './calendar-events.service';

/** Roles that see the allow-list `FamilyCalendarEventDto` rather than the
 * full staff response (D4, D9) — see `FamilyCalendarEventDto`'s doc. */
const FAMILY_ROLES: ReadonlySet<string> = new Set([
  UserRole.PARENT,
  UserRole.STUDENT,
  UserRole.TEACHER,
]);

/**
 * `/calendar/events` — the CRUD surface for `CalendarEvent` (17.x), on top
 * of the visibility, past-lock, academic-year, and attendance-guard rules
 * `CalendarEventsService` owns. Enforcement is `@RequirePermissions` — the
 * `@Roles` on each route below is a redundant, spec-checked mirror of
 * `ROLE_PERMISSIONS`'s current CALENDAR_READ/CALENDAR_MANAGE holders
 * (`permission-matrix.e2e-spec.ts`'s "documents every deliberate @Roles
 * narrowing" check), not an independent decision (D16, D19).
 */
@ApiTags('calendar-events')
@ApiTenantAuth()
@Controller('calendar')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class CalendarEventsController {
  constructor(private readonly service: CalendarEventsService) {}

  @Get('events')
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
    UserRole.EXECUTIVE,
  )
  @RequirePermissions(Permission.CALENDAR_READ)
  @ApiOperation({ summary: 'List calendar events visible to the caller, paginated.' })
  @ApiResponse({ status: 200, type: CalendarEventListResponseDto })
  async list(
    @Query() query: QueryCalendarEventsDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    const viewer = await this.service.resolveViewer(tenant.role, user.sub, tenant.id);
    const result = await this.service.list(query, tenant.id, viewer);
    return {
      ...result,
      data: this.serializeForRole(result.data, tenant.role),
    };
  }

  @Get('events/:id')
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
    UserRole.EXECUTIVE,
  )
  @RequirePermissions(Permission.CALENDAR_READ)
  @ApiOperation({ summary: 'Fetch one calendar event, if visible to the caller.' })
  @ApiResponse({ status: 200, type: CalendarEventResponseDto })
  async findOne(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    const viewer = await this.service.resolveViewer(tenant.role, user.sub, tenant.id);
    const event = await this.service.findOne(id, tenant.id, viewer);
    return this.serializeForRole([event], tenant.role)[0];
  }

  @Post('events')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.CALENDAR_MANAGE)
  @ApiOperation({ summary: 'Create a calendar event.' })
  @ApiResponse({ status: 201, type: CalendarEventResponseDto })
  async create(
    @Body() dto: CreateCalendarEventDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.create(dto, tenant.id, user.sub);
  }

  @Patch('events/:id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.CALENDAR_MANAGE)
  @ApiOperation({ summary: 'Update a calendar event.' })
  @ApiResponse({ status: 200, type: CalendarEventResponseDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCalendarEventDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.update(id, dto, tenant.id, user.sub);
  }

  @Delete('events/:id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.CALENDAR_MANAGE)
  @ApiOperation({ summary: 'Delete a calendar event.' })
  async remove(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    await this.service.remove(id, tenant.id, user.sub);
    return { success: true };
  }

  /** PARENT/STUDENT/TEACHER get the allow-list DTO; every other role
   * (ADMIN, EXECUTIVE, ACCOUNTANT) keeps the full staff response. */
  private serializeForRole(
    events: CalendarEventWithClassIds[],
    role: string,
  ): Array<CalendarEventWithClassIds | FamilyCalendarEventDto> {
    if (!FAMILY_ROLES.has(role)) {
      return events;
    }
    return events.map((event) => FamilyCalendarEventDto.fromEvent(event));
  }

  @Post('events/:id/publish')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.CALENDAR_MANAGE)
  @ApiOperation({ summary: 'Publish a draft calendar event.' })
  @ApiResponse({ status: 200, type: CalendarEventResponseDto })
  async publish(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.publish(id, tenant.id, user.sub);
  }
}
