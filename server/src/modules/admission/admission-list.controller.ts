import {
  Body,
  Controller,
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
import type { Request } from 'express';
import { ModuleKey, Permission, type JwtPayload } from '@biddaloy/shared';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { RequiresModule } from '../auth/decorators/require-module.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AdmissionListService } from './admission-list.service';
import type { ResultActor } from './admission-stage-result.service';
import {
  AdmissionListsResponseDto,
  CreateMeritListDto,
  CreateWaitingListDto,
  ListActionResponseDto,
  PatchMembersDto,
} from './dto/admission-list.dto';

/** [71.2.06] Merit list and waiting lists of a round. */
@ApiTags('admission')
@ApiTenantAuth()
@Controller('admission')
@RequiresModule(ModuleKey.admission)
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.ADMISSION_REVIEW)
export class AdmissionListController {
  constructor(private readonly lists: AdmissionListService) {}

  private actor(user: JwtPayload, request: Request): ResultActor {
    const ctx = requestContext(request);
    return { userId: user.sub, ip: ctx.ip, userAgent: ctx.userAgent };
  }

  @Post('intakes/:id/lists/merit')
  @ApiOperation({ summary: 'Build the merit list; its first `capacity` applicants are offered.' })
  @ApiCreatedResponse({ type: ListActionResponseDto })
  createMerit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateMeritListDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.lists.createMerit(id, dto, tenant.id, this.actor(user, request));
  }

  @Post('intakes/:id/lists/waiting')
  @ApiOperation({ summary: 'Build the next waiting list (inactive until activated).' })
  @ApiCreatedResponse({ type: ListActionResponseDto })
  createWaiting(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateWaitingListDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.lists.createWaiting(id, dto, tenant.id, this.actor(user, request));
  }

  @Get('intakes/:id/lists')
  @ApiOperation({ summary: 'Lists of a round with members, counts and seats left.' })
  @ApiOkResponse({ type: AdmissionListsResponseDto })
  list(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() tenant: { id: string }) {
    return this.lists.listForIntake(id, tenant.id);
  }

  @Post('lists/:id/activate')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Open the next list after the previous act-by date: lapsed offers expire, vacant seats are offered.',
  })
  @ApiOkResponse({ type: ListActionResponseDto })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.lists.activate(id, tenant.id, this.actor(user, request));
  }

  @Post('lists/:id/expire-pending')
  @HttpCode(200)
  @ApiOperation({ summary: 'Expire the offers of a list whose act-by date has passed.' })
  @ApiOkResponse({ type: ListActionResponseDto })
  expirePending(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.lists.expirePending(id, tenant.id, this.actor(user, request));
  }

  @Patch('lists/:id/members')
  @ApiOperation({ summary: 'Add, remove or reorder the members of a list that is not active yet.' })
  @ApiOkResponse({ type: ListActionResponseDto })
  patchMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchMembersDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.lists.patchMembers(id, dto, tenant.id, this.actor(user, request));
  }
}
