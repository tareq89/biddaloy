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
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { SubjectService } from './subjects.service';
import {
  CreateSubjectDto,
  UpdateSubjectDto,
  QuerySubjectDto,
  AttachClassSubjectDto,
} from './dto/subjects.dto';
import { UserRole } from '@biddaloy/shared';

@ApiTags('subjects')
@ApiTenantAuth()
@Controller('subjects')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
export class SubjectController {
  constructor(@Inject(SubjectService) private readonly service: SubjectService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @ApiOperation({ summary: 'Create a subject.' })
  create(@Body() dto: CreateSubjectDto, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.service.create(dto, tenant.id);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @ApiOperation({ summary: 'List subjects for the current tenant.' })
  findAll(@Query() query: QuerySubjectDto, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.service.findAll(query, tenant.id);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @ApiOperation({ summary: 'Get a single subject by ID.' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.findOne(id, tenant.id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @ApiOperation({ summary: 'Update a subject.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubjectDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.update(id, dto, tenant.id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @ApiOperation({ summary: 'Delete a subject.' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.remove(id, tenant.id);
  }
}

/**
 * Separate controller (rather than added to `ClassController` in
 * `classes.controller.ts`, which is already a large file of unrelated
 * concerns) for the `classes/:classId/subjects` nested routes — which
 * subjects a class offers in a given academic year.
 */
@ApiTags('subjects')
@ApiTenantAuth()
@Controller('classes')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
export class ClassSubjectController {
  constructor(@Inject(SubjectService) private readonly service: SubjectService) {}

  @Get(':classId/subjects')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @ApiOperation({ summary: "List a class's subjects for an academic year." })
  findByClass(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Query('academic_year_id', ParseUUIDPipe) academicYearId: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.findByClass(classId, academicYearId, tenant.id);
  }

  @Post(':classId/subjects')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @ApiOperation({ summary: "Attach a subject to a class's academic-year offering." })
  attach(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() dto: AttachClassSubjectDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.attachToClass(classId, dto, tenant.id);
  }

  @Delete(':classId/subjects/:subjectId')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @ApiOperation({ summary: "Detach a subject from a class's academic-year offering." })
  detach(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @Query('academic_year_id', ParseUUIDPipe) academicYearId: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.detachFromClass(classId, subjectId, academicYearId, tenant.id);
  }
}
