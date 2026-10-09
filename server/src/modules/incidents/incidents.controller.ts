import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { IncidentsService } from './incidents.service';
import { CreateIncidentDto, IncidentResponseDto, QueryIncidentsDto } from './dto/incident.dto';

@ApiTags('incidents')
@ApiTenantAuth()
@Controller('incidents')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class IncidentsController {
  constructor(private readonly service: IncidentsService) {}

  @Post()
  @HttpCode(201)
  @RequirePermissions(Permission.ACR_WRITE)
  @ApiOperation({ summary: 'Report an incident about a staff member.' })
  @ApiResponse({ status: 201, type: IncidentResponseDto })
  create(
    @Body() dto: CreateIncidentDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.create(dto, tenant.id, user.sub);
  }

  @Get()
  @RequirePermissions(Permission.ACR_READ)
  @ApiOperation({ summary: 'List incidents (never the caller’s own).' })
  @ApiResponse({ status: 200, type: [IncidentResponseDto] })
  list(
    @Query() query: QueryIncidentsDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.list(query, tenant.id, user.sub);
  }

  @Get(':id')
  @RequirePermissions(Permission.ACR_READ)
  @ApiOperation({ summary: 'One incident; 404 when it is about the caller.' })
  @ApiResponse({ status: 200, type: IncidentResponseDto })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.findOne(id, tenant.id, user.sub);
  }
}
