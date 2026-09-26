import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { SeatPlansService } from './seat-plans.service';
import { GenerateSeatPlanDto } from './dto/generate-seat-plan.dto';
import { UpdateAllocationDto, UpdateInvigilatorDto } from './dto/update-allocation.dto';
import { PublishSeatPlanDto } from './dto/publish-seat-plan.dto';

/**
 * [25.4] Generate, list/view, manually edit, reshuffle, assign invigilators
 * to, and publish exam seat plans. All routes require
 * `exams:seat-plan-manage` (`Permission.SEAT_PLAN_MANAGE`).
 */
@ApiTags('seat-plans')
@ApiTenantAuth()
@Controller('seat-plans')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.SEAT_PLAN_MANAGE)
export class SeatPlansController {
  constructor(private readonly seatPlans: SeatPlansService) {}

  @Post('generate')
  @ApiOperation({ summary: 'Generate a draft seat plan for the given exam schedules and rooms.' })
  async generate(@Body() dto: GenerateSeatPlanDto, @CurrentTenant() tenant: { id: string }) {
    return this.seatPlans.generate(tenant.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List seat plans for the current tenant.' })
  async findAll(@CurrentTenant() tenant: { id: string }) {
    return this.seatPlans.findAll(tenant.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Seat plan detail, allocations grouped by room.' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() tenant: { id: string }) {
    return this.seatPlans.findOne(tenant.id, id);
  }

  @Patch(':id/allocations/:allocationId')
  @ApiOperation({ summary: 'Manually move a student to a different room/seat (DRAFT only).' })
  async updateAllocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('allocationId', ParseUUIDPipe) allocationId: string,
    @Body() dto: UpdateAllocationDto,
    @CurrentTenant() tenant: { id: string },
  ) {
    return this.seatPlans.updateAllocation(tenant.id, id, allocationId, dto);
  }

  @Post(':id/rooms/:roomId/reshuffle')
  @ApiOperation({ summary: "Re-run allocation for just one room's students (DRAFT only)." })
  async reshuffleRoom(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @CurrentTenant() tenant: { id: string },
  ) {
    return this.seatPlans.reshuffleRoom(tenant.id, id, roomId);
  }

  @Patch(':id/rooms/:roomId/invigilator')
  @ApiOperation({ summary: "Set or clear a room's invigilator for this plan." })
  async updateInvigilator(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: UpdateInvigilatorDto,
    @CurrentTenant() tenant: { id: string },
  ) {
    return this.seatPlans.updateInvigilator(tenant.id, id, roomId, dto);
  }

  @Post(':id/publish')
  @ApiOperation({
    summary: 'Publish a DRAFT plan: re-checks room conflicts, then locks its schedules and allocations.',
  })
  async publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _dto: PublishSeatPlanDto,
    @CurrentTenant() tenant: { id: string },
  ) {
    return this.seatPlans.publish(tenant.id, id);
  }
}
