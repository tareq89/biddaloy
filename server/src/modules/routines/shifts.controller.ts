import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  Inject,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { ShiftsService } from './shifts.service';
import { PeriodSlotsService } from './period-slots.service';
import {
  CreateShiftDto,
  UpdateShiftDto,
  QueryShiftDto,
  ReplacePeriodSlotsDto,
  ChangeoverSuggestionQueryDto,
} from './dto/setup.dto';
import { Permission, UserRole } from '@biddaloy/shared';

const READ_ROLES = [
  UserRole.ADMIN,
  UserRole.EXECUTIVE,
  UserRole.TEACHER,
  UserRole.PARENT,
  UserRole.STUDENT,
];

/** [21.3.1] Shift CRUD plus its nested period-slot editor. */
@ApiTags('routines')
@ApiTenantAuth()
@Controller('routines/shifts')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ShiftsController {
  constructor(
    @Inject(ShiftsService) private readonly shiftsService: ShiftsService,
    @Inject(PeriodSlotsService) private readonly periodSlotsService: PeriodSlotsService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ROUTINE_MANAGE)
  @ApiOperation({ summary: 'Create a shift.' })
  create(@Body() dto: CreateShiftDto, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.shiftsService.create(dto, tenant.id);
  }

  @Get()
  @Roles(...READ_ROLES)
  @RequirePermissions(Permission.ROUTINE_READ)
  @ApiOperation({ summary: 'List shifts.' })
  findAll(@Query() query: QueryShiftDto, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.shiftsService.findAll(query, tenant.id);
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  @RequirePermissions(Permission.ROUTINE_READ)
  @ApiOperation({ summary: 'Get a shift by ID.' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.shiftsService.findOne(id, tenant.id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ROUTINE_MANAGE)
  @ApiOperation({ summary: 'Update a shift.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShiftDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.shiftsService.update(id, dto, tenant.id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ROUTINE_MANAGE)
  @ApiOperation({ summary: 'Delete a shift.' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.shiftsService.remove(id, tenant.id);
  }

  // --- Period slots (nested under shift) ---

  @Get(':id/period-slots')
  @Roles(...READ_ROLES)
  @RequirePermissions(Permission.ROUTINE_READ)
  @ApiOperation({ summary: "List a shift's period slots." })
  findPeriodSlots(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.periodSlotsService.findForShift(id, tenant.id);
  }

  @Put(':id/period-slots')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ROUTINE_MANAGE)
  @ApiOperation({ summary: "Replace a shift's whole period-slot set." })
  replacePeriodSlots(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplacePeriodSlotsDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.periodSlotsService.replaceForShift(id, dto, tenant.id);
  }

  @Get(':id/period-slots/changeover-suggestion')
  @Roles(...READ_ROLES)
  @RequirePermissions(Permission.ROUTINE_READ)
  @ApiOperation({ summary: 'Suggest starts_at/ends_at for a proposed period count/duration (D7).' })
  suggestChangeover(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ChangeoverSuggestionQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.periodSlotsService.suggestChangeover(id, query, tenant.id);
  }
}
