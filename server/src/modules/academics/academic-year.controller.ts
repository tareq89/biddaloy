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
  Inject,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { AcademicYearService } from './academic-year.service';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { UpdateAcademicYearDto } from './dto/update-academic-year.dto';
import { QueryAcademicYearDto } from './dto/query-academic-year.dto';
import { Permission, UserRole, JwtPayload } from '@biddaloy/shared';

@ApiTags('academic-years')
@ApiTenantAuth()
@Controller('academic-years')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class AcademicYearController {
  constructor(@Inject(AcademicYearService) private readonly service: AcademicYearService) {}

  @Post()
  // [10.4] G1, G2 — AC, E tightened off: neither holds ACADEMIC_YEAR_MANAGE.
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ACADEMIC_YEAR_MANAGE)
  create(
    @Body() dto: CreateAcademicYearDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.create(dto, tenant.id, user.sub, requestContext(request));
  }

  @Get()
  // [10.4] G4 — reference-data read.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @RequirePermissions(Permission.ACADEMIC_STRUCTURE_READ)
  findAll(
    @Query() query: QueryAcademicYearDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.findAll(query, tenant.id);
  }

  @Get(':id')
  // [10.4] G4 — reference-data read.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @RequirePermissions(Permission.ACADEMIC_STRUCTURE_READ)
  findOne(@Param('id') id: string, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.service.findOne(id, tenant.id);
  }

  @Get(':id/stats')
  // [10.4] G4 — reference-data read.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @RequirePermissions(Permission.ACADEMIC_STRUCTURE_READ)
  @ApiOperation({
    summary: 'Class/student/fee-structure counts attached to this academic year.',
  })
  getStats(@Param('id') id: string, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.service.getStats(id, tenant.id);
  }

  @Patch(':id')
  // [10.4] G1, G2 — AC, E tightened off.
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ACADEMIC_YEAR_MANAGE)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAcademicYearDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.update(id, dto, tenant.id, user.sub, requestContext(request));
  }

  @Delete(':id')
  // [10.4] G1, G2 — AC, E tightened off.
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ACADEMIC_YEAR_MANAGE)
  remove(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.remove(id, tenant.id, user.sub, requestContext(request));
  }

  @Post(':id/set-current')
  // [10.4] G1, G2 — AC, E tightened off.
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ACADEMIC_YEAR_MANAGE)
  @ApiOperation({
    summary:
      "Mark this academic year as the tenant's current one, unsetting any other year previously marked current.",
  })
  setCurrent(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.setCurrent(id, tenant.id, user.sub, requestContext(request));
  }
}
