import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  Inject,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { ChangeRequestsService } from './change-requests.service';
import { CreateChangeRequestDto, ResolveChangeRequestDto } from './dto/workflow.dto';
import { JwtPayload, Permission, UserRole } from '@biddaloy/shared';

/** [21.6.1] D11: change requests against a published `RoutineSlot`. */
@ApiTags('routines')
@ApiTenantAuth()
@Controller('routines')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ChangeRequestsController {
  constructor(@Inject(ChangeRequestsService) private readonly service: ChangeRequestsService) {}

  @Post('slots/:slotId/change-requests')
  @Roles(UserRole.TEACHER)
  @RequirePermissions(Permission.ROUTINE_READ)
  @ApiOperation({ summary: 'Teacher flags a published slot for the builder.' })
  open(
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Body() dto: CreateChangeRequestDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.open(slotId, dto, tenant.id, user.sub);
  }

  @Get(':id/change-requests')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ROUTINE_MANAGE)
  @ApiOperation({ summary: "List a routine's change requests." })
  findForRoutine(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.findForRoutine(id, tenant.id);
  }

  @Patch('change-requests/:id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.ROUTINE_MANAGE)
  @ApiOperation({
    summary: 'Accept or reject a change request. Any ROUTINE_MANAGE holder may resolve it.',
  })
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveChangeRequestDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.resolve(id, dto, tenant.id, user.sub, requestContext(request));
  }
}
