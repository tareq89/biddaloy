import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { EMPLOYEE_ROLES, Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { ApplicationsService } from './applications.service';
import {
  AddTagsDto,
  AddresseeOptionDto,
  ApplicationDto,
  ApplicationEventDto,
  ApplicationListDto,
  CommentDto,
  CreateApplicationDto,
  LetterPreviewDto,
  LetterPreviewResultDto,
  TagOptionsDto,
} from './dto/application.dto';
import {
  QueryAddresseesDto,
  QueryApplicationsDto,
  QueryTagOptionsDto,
} from './dto/query-applications.dto';

type Tenant = { id: string; role: UserRole };
type Actor = { sub: string };

/**
 * Every route needs APPLICATION_SUBMIT (all tenant roles but SUPER_ADMIN/COMMITTEE hold it).
 * What a caller may see or do on a given application is decided in the service, not here.
 * `addressees`, `tag-options` and `letter-preview` are declared before `:id` so they are not
 * read as ids.
 */
@ApiTags('applications')
@ApiTenantAuth()
@Controller('applications')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.APPLICATION_SUBMIT)
export class ApplicationsController {
  constructor(private readonly service: ApplicationsService) {}

  @Post()
  @ApiOperation({ summary: 'Submit an application (any of the 10 types)' })
  @ApiCreatedResponse({ type: ApplicationDto })
  submit(
    @Body() dto: CreateApplicationDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: Actor,
    @Req() req: Request,
  ): Promise<ApplicationDto> {
    return this.service.submit(
      tenant.id,
      { userId: user.sub, role: tenant.role },
      dto,
      requestContext(req),
    );
  }

  @Get()
  @ApiOperation({ summary: 'List applications: inbox (to decide), mine, or all' })
  @ApiOkResponse({ type: ApplicationListDto })
  list(
    @Query() query: QueryApplicationsDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: Actor,
  ): Promise<ApplicationListDto> {
    return this.service.list(tenant.id, { userId: user.sub, role: tenant.role }, query);
  }

  @Get('addressees')
  @ApiOperation({ summary: 'Who a general application can be addressed to' })
  @ApiOkResponse({ type: [AddresseeOptionDto] })
  addressees(
    @Query() query: QueryAddresseesDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: Actor,
  ): Promise<AddresseeOptionDto[]> {
    return this.service.addressees(
      tenant.id,
      { userId: user.sub, role: tenant.role },
      query.student_id,
    );
  }

  @Get('tag-options')
  @Roles(...EMPLOYEE_ROLES) // D50: guardians and students never see the staff list
  @ApiOperation({ summary: 'Staff users and roles that can be tagged' })
  @ApiOkResponse({ type: TagOptionsDto })
  tagOptions(
    @Query() query: QueryTagOptionsDto,
    @CurrentTenant() tenant: Tenant,
  ): Promise<TagOptionsDto> {
    return this.service.tagOptions(tenant.id, query.q ?? '');
  }

  @Post('letter-preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Render the letter for a draft application; writes nothing' })
  @ApiOkResponse({ type: LetterPreviewResultDto })
  letterPreview(
    @Body() dto: LetterPreviewDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: Actor,
  ): Promise<LetterPreviewResultDto> {
    return this.service.letterPreview(tenant.id, { userId: user.sub, role: tenant.role }, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One application with its events, tags and attachments' })
  @ApiOkResponse({ type: ApplicationDto })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: Actor,
  ): Promise<ApplicationDto> {
    return this.service.get(tenant.id, { userId: user.sub, role: tenant.role }, id);
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  @ApiOperation({ summary: 'Withdraw your own pending application' })
  @ApiOkResponse({ type: ApplicationDto })
  withdraw(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: Actor,
    @Req() req: Request,
  ): Promise<ApplicationDto> {
    return this.service.withdraw(
      tenant.id,
      { userId: user.sub, role: tenant.role },
      id,
      requestContext(req),
    );
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'Add a comment to an application you can see' })
  @ApiCreatedResponse({ type: ApplicationEventDto })
  comment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommentDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: Actor,
  ): Promise<ApplicationEventDto> {
    return this.service.comment(tenant.id, { userId: user.sub, role: tenant.role }, id, dto.note);
  }

  @Post(':id/tags')
  @Roles(...EMPLOYEE_ROLES) // D50
  @HttpCode(200)
  @ApiOperation({ summary: 'Tag people or roles on an application' })
  @ApiOkResponse({ type: ApplicationDto })
  addTags(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddTagsDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: Actor,
  ): Promise<ApplicationDto> {
    return this.service.addTags(tenant.id, { userId: user.sub, role: tenant.role }, id, dto.tags);
  }
}
