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
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ClassService, SectionService } from './classes.service';
import {
  CreateClassDto,
  UpdateClassDto,
  QueryClassDto,
  CreateSectionDto,
  UpdateSectionDto,
} from './dto/classes.dto';
import { UserRole } from '@beton-boi/shared';

@Controller('classes')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
export class ClassController {
  constructor(
    private readonly classService: ClassService,
    private readonly sectionService: SectionService,
  ) {}

  // --- Class endpoints ---

  @Post()
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  createClass(
    @Body() dto: CreateClassDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.classService.create(dto, tenant.id);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  findAllClasses(
    @Query() query: QueryClassDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.classService.findAll(query, tenant.id);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  findOneClass(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.classService.findOne(id, tenant.id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  updateClass(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClassDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.classService.update(id, dto, tenant.id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  removeClass(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.classService.remove(id, tenant.id);
  }

  // --- Section endpoints (nested under class) ---

  @Post(':classId/sections')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  createSection(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() dto: CreateSectionDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.sectionService.create(classId, dto, tenant.id);
  }

  @Get(':classId/sections')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  findAllSections(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.sectionService.findAll(classId, tenant.id);
  }

  @Patch(':classId/sections/:sectionId')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  updateSection(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Body() dto: UpdateSectionDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.sectionService.update(classId, sectionId, dto, tenant.id);
  }

  @Delete(':classId/sections/:sectionId')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  removeSection(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.sectionService.remove(classId, sectionId, tenant.id);
  }
}