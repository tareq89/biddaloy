import {
  Controller,
  Get,
  Post,
  Patch,
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
import { RoutineService } from './routine.service';
import { RoutineSlotsService } from './routine-slots.service';
import { GreedyFillService } from './greedy-fill.service';
import {
  CreateRoutineDto,
  UpsertRoutineSlotDto,
  GreedyFillQueryDto,
} from './dto/routine-slots.dto';
import { Permission, UserRole } from '@biddaloy/shared';

const READ_ROLES = [
  UserRole.ADMIN,
  UserRole.EXECUTIVE,
  UserRole.TEACHER,
  UserRole.PARENT,
  UserRole.STUDENT,
];

/** [21.4.1] Routine document + its slots, plus the greedy-fill proposer. */
@ApiTags('routines')
@ApiTenantAuth()
@Controller('routines')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class RoutineSlotsController {
  constructor(
    @Inject(RoutineService) private readonly routineService: RoutineService,
    @Inject(RoutineSlotsService) private readonly slotsService: RoutineSlotsService,
    @Inject(GreedyFillService) private readonly greedyFillService: GreedyFillService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ROUTINE_MANAGE)
  @ApiOperation({ summary: 'Create a draft routine for an academic year.' })
  create(@Body() dto: CreateRoutineDto, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.routineService.create(dto, tenant.id);
  }

  @Get()
  @Roles(...READ_ROLES)
  @RequirePermissions(Permission.ROUTINE_READ)
  @ApiOperation({ summary: 'List routines.' })
  findAll(@CurrentTenant() tenant: { id: string; role: string }) {
    return this.routineService.findAll(tenant.id);
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  @RequirePermissions(Permission.ROUTINE_READ)
  @ApiOperation({ summary: 'Get a routine by ID.' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.routineService.findOne(id, tenant.id);
  }

  @Get(':id/slots')
  @Roles(...READ_ROLES)
  @RequirePermissions(Permission.ROUTINE_READ)
  @ApiOperation({ summary: "List a routine's slots." })
  findSlots(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.slotsService.findForRoutine(id, tenant.id);
  }

  @Post(':id/slots')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ROUTINE_MANAGE)
  @ApiOperation({ summary: 'Create a routine slot (hard constraints enforced server-side).' })
  createSlot(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertRoutineSlotDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.slotsService.create(id, dto, tenant.id);
  }

  @Patch('slots/:slotId')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ROUTINE_MANAGE)
  @ApiOperation({
    summary: 'Effective-date an edit to a slot (D4: closes the old row, opens a new one).',
  })
  updateSlot(
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Body() dto: UpsertRoutineSlotDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.slotsService.update(slotId, dto, tenant.id);
  }

  @Delete('slots/:slotId')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ROUTINE_MANAGE)
  @ApiOperation({ summary: 'Delete a routine slot.' })
  removeSlot(
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.slotsService.remove(slotId, tenant.id);
  }

  @Get(':id/greedy-fill')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ROUTINE_MANAGE)
  @ApiOperation({ summary: 'Propose slots for empty grid cells — does not write anything.' })
  greedyFill(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: GreedyFillQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.greedyFillService.fill(id, query, tenant.id);
  }
}
