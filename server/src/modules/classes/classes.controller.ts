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
import { ClassService, SectionService } from './classes.service';
import {
  CreateClassDto,
  UpdateClassDto,
  QueryClassDto,
  CreateSectionDto,
  UpdateSectionDto,
} from './dto/classes.dto';
import { Permission, UserRole } from '@biddaloy/shared';

@ApiTags('classes')
@ApiTenantAuth()
@Controller('classes')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ClassController {
  constructor(
    @Inject(ClassService) private readonly classService: ClassService,
    @Inject(SectionService) private readonly sectionService: SectionService,
  ) {}

  // --- Class endpoints ---

  @Post()
  // [10.4] G1, G2 — AC, E tightened off: neither holds CLASS_MANAGE.
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.CLASS_MANAGE)
  @ApiOperation({ summary: 'Create a class under an academic year.' })
  createClass(@Body() dto: CreateClassDto, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.classService.create(dto, tenant.id);
  }

  @Get()
  // [10.4] G4 — reference-data read.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @RequirePermissions(Permission.ACADEMIC_STRUCTURE_READ)
  @ApiOperation({ summary: 'List classes for the current tenant.' })
  findAllClasses(
    @Query() query: QueryClassDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.classService.findAll(query, tenant.id);
  }

  @Get(':id')
  // [10.4] G4 — reference-data read.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @RequirePermissions(Permission.ACADEMIC_STRUCTURE_READ)
  @ApiOperation({ summary: 'Get a single class by ID.' })
  findOneClass(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.classService.findOne(id, tenant.id);
  }

  @Patch(':id')
  // [10.4] G1, G2 — AC, E tightened off.
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.CLASS_MANAGE)
  @ApiOperation({ summary: 'Update a class.' })
  updateClass(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClassDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.classService.update(id, dto, tenant.id);
  }

  @Delete(':id')
  // [10.4] G1, G2 — AC, E tightened off.
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.CLASS_MANAGE)
  removeClass(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.classService.remove(id, tenant.id);
  }

  // --- Section endpoints (nested under class) ---

  @Post(':classId/sections')
  // [10.4] G1, G2 — AC, E tightened off.
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.CLASS_MANAGE)
  createSection(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() dto: CreateSectionDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.sectionService.create(classId, dto, tenant.id);
  }

  @Get(':classId/sections')
  // [10.4] G4 — reference-data read.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @RequirePermissions(Permission.ACADEMIC_STRUCTURE_READ)
  findAllSections(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.sectionService.findAll(classId, tenant.id);
  }

  @Patch(':classId/sections/:sectionId')
  // [10.4] G1, G2 — AC, E tightened off.
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.CLASS_MANAGE)
  updateSection(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Body() dto: UpdateSectionDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.sectionService.update(classId, sectionId, dto, tenant.id);
  }

  @Delete(':classId/sections/:sectionId')
  // [10.4] G1, G2 — AC, E tightened off.
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.CLASS_MANAGE)
  removeSection(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.sectionService.remove(classId, sectionId, tenant.id);
  }

  // --- Teachers (read-only; teacher CRUD is #177) ---

  @Get(':classId/teachers')
  // [10.4] G4 — reference-data read.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @RequirePermissions(Permission.ACADEMIC_STRUCTURE_READ)
  @ApiOperation({ summary: 'List distinct teachers assigned to any section of this class.' })
  findClassTeachers(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.sectionService.findTeachers(classId, tenant.id);
  }
}
