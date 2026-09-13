import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { FeeGenerationsService } from './fee-generations.service';
import { QueryFeeGenerationBillsDto, QueryFeeGenerationsDto } from './dto/fee-generations.dto';
import { Permission, UserRole } from '@biddaloy/shared';

/**
 * [16.1.4] Read-only log of fee-generation batches (`fee_generations`) — the
 * data behind the "Generation log" page. Writing a batch happens as a side
 * effect of generating fees (16.3.1) or a scheduled run (16.7.2), through
 * `FeeGenerationsService.create`, not through this controller.
 */
@ApiTags('fee-generations')
@ApiTenantAuth()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@Controller('fees/generations')
export class FeeGenerationsController {
  constructor(private readonly service: FeeGenerationsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @RequirePermissions(Permission.FEE_READ)
  @ApiOperation({
    summary:
      'Page of fee-generation batches, newest first, with billed/collected totals and collection status.',
  })
  findAll(
    @Query() query: QueryFeeGenerationsDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.findAll(query, tenant.id);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @RequirePermissions(Permission.FEE_READ)
  @ApiOperation({ summary: 'One fee-generation batch.' })
  findOne(@Param('id') id: string, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.service.findOne(id, tenant.id);
  }

  @Get(':id/bills')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @RequirePermissions(Permission.FEE_READ)
  @ApiOperation({ summary: 'Paged bills this batch created, with student/fee detail.' })
  findBills(
    @Param('id') id: string,
    @Query() query: QueryFeeGenerationBillsDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.findBills(id, query, tenant.id);
  }
}
