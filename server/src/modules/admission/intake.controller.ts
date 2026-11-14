import { RequiresModule } from '../auth/decorators/require-module.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, ModuleKey } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { IntakeService } from './intake.service';
import { AdmissionStageService } from './admission-stage.service';
import { CreateStageDto, UpdateStageDto } from './dto/stage.dto';
import { CreateIntakeDto } from './dto/create-intake.dto';
import { UpdateIntakeDto } from './dto/update-intake.dto';

/** [27.3] Staff CRUD over admission intakes — ADMIN only, gated by
 * ADMISSION_REVIEW (see `shared/src/enums/permissions.ts` role map). */
@ApiTags('admission')
@ApiTenantAuth()
@Controller('admission-intakes')
@RequiresModule(ModuleKey.admission)
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.ADMISSION_REVIEW)
export class IntakeController {
  constructor(
    private readonly intakes: IntakeService,
    private readonly stages: AdmissionStageService,
  ) {}

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
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
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
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.intakes.close(id, tenant.id);
  }

  @Get(':id/stages')
  @ApiOperation({ summary: 'List the stages of a round, in order.' })
  listStages(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.stages.list(id, tenant.id);
  }

  @Post(':id/stages')
  @ApiOperation({ summary: 'Add a stage at the end of a round.' })
  createStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateStageDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.stages.create(id, dto, tenant.id);
  }

  @Patch(':id/stages/:stageId')
  @ApiOperation({ summary: 'Edit a stage of a round.' })
  updateStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stageId', ParseUUIDPipe) stageId: string,
    @Body() dto: UpdateStageDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.stages.update(id, stageId, dto, tenant.id);
  }

  @Delete(':id/stages/:stageId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a stage that has no results (409 otherwise).' })
  removeStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stageId', ParseUUIDPipe) stageId: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.stages.remove(id, stageId, tenant.id);
  }
}
