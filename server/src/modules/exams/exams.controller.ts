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
  Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { ExamsService } from './exams.service';
import { CreateExamDto, CreateExamResponseDto, UpdateExamDto, QueryExamDto } from './dto/exams.dto';
import { Permission, JwtPayload } from '@biddaloy/shared';

@ApiTags('exams')
@ApiTenantAuth()
@Controller('exams')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ExamsController {
  constructor(private readonly examsService: ExamsService) {}

  @Post()
  @RequirePermissions(Permission.EXAM_MANAGE)
  @ApiOperation({ summary: 'Create an exam, optionally building its components from a template.' })
  @ApiCreatedResponse({ type: CreateExamResponseDto })
  create(
    @Body() dto: CreateExamDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.examsService.create(dto, tenant.id, user.sub, requestContext(request));
  }

  // Read-only list on MARK_VIEW, not EXAM_MANAGE: the marks-entry and
  // analysis screens (both MARK_VIEW routes) use it as their exam picker,
  // and those serve teachers and executives too. Tenant-scoped exam
  // metadata only — those roles can already read marks/progress/analysis
  // for any exam id in the tenant. `findOne` and every write stay
  // ADMIN + EXAM_MANAGE.
  @Get()
  @RequirePermissions(Permission.MARK_VIEW)
  @ApiOperation({ summary: 'List exams for the current tenant.' })
  findAll(@Query() query: QueryExamDto, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.examsService.findAll(query, tenant.id);
  }

  @Get(':id')
  @RequirePermissions(Permission.EXAM_MANAGE)
  @ApiOperation({ summary: 'Get a single exam by ID.' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.examsService.findOne(id, tenant.id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.EXAM_MANAGE)
  @ApiOperation({ summary: 'Update an exam.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExamDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.examsService.update(id, dto, tenant.id, user.sub, requestContext(request));
  }

  @Delete(':id')
  @RequirePermissions(Permission.EXAM_MANAGE)
  @ApiOperation({ summary: 'Delete an exam.' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.examsService.remove(id, tenant.id, user.sub, requestContext(request));
  }
}
