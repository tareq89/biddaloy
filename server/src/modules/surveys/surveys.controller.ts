import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { SurveysService } from './surveys.service';
import { CreateSurveyDto, UpdateSurveyDto } from './dto/survey.dto';

type Tenant = { id: string };

/** [28.2.4] Teacher-evaluation survey lifecycle. ADMIN only (ACR_READ / ACR_WRITE). */
@ApiTags('surveys')
@ApiTenantAuth()
@Controller('surveys')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
export class SurveysController {
  constructor(private readonly surveysService: SurveysService) {}

  @Post()
  @RequirePermissions(Permission.ACR_WRITE)
  @ApiOperation({ summary: 'Create a DRAFT survey with questions and targets.' })
  create(@Body() dto: CreateSurveyDto, @CurrentTenant() tenant: Tenant) {
    return this.surveysService.create(dto, tenant.id);
  }

  @Get()
  @RequirePermissions(Permission.ACR_READ)
  @ApiOperation({ summary: 'List surveys.' })
  findAll(@CurrentTenant() tenant: Tenant) {
    return this.surveysService.findAll(tenant.id);
  }

  @Get(':id')
  @RequirePermissions(Permission.ACR_READ)
  @ApiOperation({ summary: 'One survey with questions and targets.' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() tenant: Tenant) {
    return this.surveysService.findOne(id, tenant.id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.ACR_WRITE)
  @ApiOperation({ summary: 'Edit a DRAFT survey.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSurveyDto,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.surveysService.update(id, dto, tenant.id);
  }

  @Post(':id/publish')
  @RequirePermissions(Permission.ACR_WRITE)
  @ApiOperation({ summary: 'DRAFT -> OPEN.' })
  publish(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() tenant: Tenant) {
    return this.surveysService.publish(id, tenant.id);
  }

  @Post(':id/close')
  @RequirePermissions(Permission.ACR_WRITE)
  @ApiOperation({ summary: 'OPEN -> CLOSED.' })
  close(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() tenant: Tenant) {
    return this.surveysService.close(id, tenant.id);
  }
}
