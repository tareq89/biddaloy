import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { IntakeService } from './intake.service';
import { CreateIntakeDto } from './dto/create-intake.dto';
import { UpdateIntakeDto } from './dto/update-intake.dto';

/** [27.3] Staff CRUD over admission intakes — ADMIN only, gated by
 * ADMISSION_REVIEW (see `shared/src/enums/permissions.ts` role map). */
@ApiTags('admission')
@ApiTenantAuth()
@Controller('admission-intakes')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermissions(Permission.ADMISSION_REVIEW)
export class IntakeController {
  constructor(private readonly intakes: IntakeService) {}

  @Post()
  @ApiOperation({ summary: 'Open a new admission intake window for a class section.' })
  create(@Body() dto: CreateIntakeDto, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.intakes.create(dto, tenant.id);
  }

  @Get()
  @ApiOperation({ summary: 'List admission intakes for this tenant, newest first.' })
  findAll(@CurrentTenant() tenant: { id: string; role: string }) {
    return this.intakes.findAll(tenant.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one admission intake.' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.intakes.findOne(id, tenant.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit an admission intake.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIntakeDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.intakes.update(id, dto, tenant.id);
  }

  @Patch(':id/close')
  @ApiOperation({ summary: 'Close an admission intake immediately.' })
  close(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.intakes.close(id, tenant.id);
  }
}
