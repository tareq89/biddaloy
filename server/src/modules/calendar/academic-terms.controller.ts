import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
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
import { AcademicTermsService } from './academic-terms.service';
import {
  CreateTermDto,
  UpdateTermDto,
  ReorderTermsDto,
  toTermResponseDto,
} from './dto/academic-terms.dto';
import { JwtPayload, Permission, UserRole } from '@biddaloy/shared';

/**
 * [17.2.2] `GET /calendar/terms` (`CALENDAR_READ`) and the write routes
 * (`CALENDAR_MANAGE`) for `AcademicTerm` CRUD + reorder. Removing
 * `Permission.CALENDAR_READ`/`CALENDAR_MANAGE` from
 * `permission-matrix.e2e-spec.ts`'s `UI_ONLY_PERMISSIONS` list is required
 * alongside this file — that spec fails otherwise, since the permission is
 * no longer UI-only once a route declares it.
 */
@ApiTags('academic-terms')
@ApiTenantAuth()
@Controller('calendar/terms')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class AcademicTermsController {
  constructor(private readonly service: AcademicTermsService) {}

  @Get()
  // Every role holds CALENDAR_READ (shared/src/enums/permissions.ts) — list
  // them all here so PermissionsGuard, not this coarser RolesGuard, is what
  // actually decides access.
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
  )
  @RequirePermissions(Permission.CALENDAR_READ)
  @ApiOperation({ summary: 'List terms for an academic year, ordered by seq.' })
  async list(
    @Query('academic_year_id', ParseUUIDPipe) academicYearId: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const terms = await this.service.listByYear(tenant.id, academicYearId);
    return terms.map(toTermResponseDto);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.CALENDAR_MANAGE)
  @ApiOperation({ summary: 'Create a term. seq is assigned as max(seq) + 1 for the year.' })
  async create(
    @Body() dto: CreateTermDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const term = await this.service.create(tenant.id, dto, user.sub, requestContext(request));
    return toTermResponseDto(term);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.CALENDAR_MANAGE)
  @ApiOperation({ summary: 'Update a term (name and/or dates).' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTermDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const term = await this.service.update(tenant.id, id, dto, user.sub, requestContext(request));
    return toTermResponseDto(term);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.CALENDAR_MANAGE)
  @ApiOperation({ summary: 'Soft-delete a term and resequence the remaining ones densely.' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<{ deleted: true }> {
    await this.service.remove(tenant.id, id, user.sub, requestContext(request));
    return { deleted: true };
  }

  @Post('reorder')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.CALENDAR_MANAGE)
  @ApiOperation({ summary: "Rewrite a year's term seq densely to match the given id order." })
  async reorder(
    @Body() dto: ReorderTermsDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const terms = await this.service.reorder(
      tenant.id,
      dto.academic_year_id,
      dto.ids,
      user.sub,
      requestContext(request),
    );
    return terms.map(toTermResponseDto);
  }
}
