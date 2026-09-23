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
import { RoomsService } from './rooms.service';
import { CreateRoomDto, UpdateRoomDto, QueryRoomDto } from './dto/setup.dto';
import { Permission, UserRole } from '@biddaloy/shared';

const READ_ROLES = [
  UserRole.ADMIN,
  UserRole.EXECUTIVE,
  UserRole.TEACHER,
  UserRole.PARENT,
  UserRole.STUDENT,
];

/** [21.3.1] Room CRUD. */
@ApiTags('routines')
@ApiTenantAuth()
@Controller('routines/rooms')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class RoomsController {
  constructor(@Inject(RoomsService) private readonly roomsService: RoomsService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ROUTINE_MANAGE)
  @ApiOperation({ summary: 'Create a room.' })
  create(@Body() dto: CreateRoomDto, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.roomsService.create(dto, tenant.id);
  }

  @Get()
  @Roles(...READ_ROLES)
  @RequirePermissions(Permission.ROUTINE_READ)
  @ApiOperation({ summary: 'List rooms.' })
  findAll(@Query() query: QueryRoomDto, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.roomsService.findAll(query, tenant.id);
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  @RequirePermissions(Permission.ROUTINE_READ)
  @ApiOperation({ summary: 'Get a room by ID.' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.roomsService.findOne(id, tenant.id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ROUTINE_MANAGE)
  @ApiOperation({ summary: 'Update a room.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoomDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.roomsService.update(id, dto, tenant.id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ROUTINE_MANAGE)
  @ApiOperation({ summary: 'Delete a room.' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.roomsService.remove(id, tenant.id);
  }
}
