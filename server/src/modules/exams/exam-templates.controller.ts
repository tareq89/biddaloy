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
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { ExamTemplatesService } from './exam-templates.service';
import {
  CreateExamTemplateDto,
  ExamTemplateDetailDto,
  ExamTemplateSummaryDto,
  UpdateExamTemplateDto,
} from './dto/exam-template.dto';
import { Permission, JwtPayload } from '@biddaloy/shared';

type Tenant = { id: string; role: string };

/** [35.4.1] Exam templates CRUD (D36: EXAM_MANAGE). */
@ApiTags('exam-templates')
@ApiTenantAuth()
@Controller('exam-templates')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.EXAM_MANAGE)
export class ExamTemplatesController {
  constructor(private readonly service: ExamTemplatesService) {}

  @Get()
  @ApiOperation({ summary: 'List exam templates.' })
  @ApiOkResponse({ type: [ExamTemplateSummaryDto] })
  list(@CurrentTenant() tenant: Tenant): Promise<ExamTemplateSummaryDto[]> {
    return this.service.list(tenant.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one exam template with its rows.' })
  @ApiOkResponse({ type: ExamTemplateDetailDto })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
  ): Promise<ExamTemplateDetailDto> {
    return this.service.get(id, tenant.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create an empty exam template.' })
  @ApiCreatedResponse({ type: ExamTemplateDetailDto })
  create(
    @Body() dto: CreateExamTemplateDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<ExamTemplateDetailDto> {
    return this.service.create(dto, tenant.id, user.sub, requestContext(request));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename / change kind / replace all rows of a template.' })
  @ApiOkResponse({ type: ExamTemplateDetailDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExamTemplateDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<ExamTemplateDetailDto> {
    return this.service.update(id, dto, tenant.id, user.sub, requestContext(request));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete a template (its component rows are removed).' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<void> {
    await this.service.remove(id, tenant.id, user.sub, requestContext(request));
  }
}
