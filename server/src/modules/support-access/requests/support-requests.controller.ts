import {
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
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtPayload, Permission } from '@biddaloy/shared';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../../common/request-context.util';
import { SETTINGS_RATE_LIMIT } from '../../../rate-limit';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { DenyWhenImpersonating } from '../../auth/decorators/deny-when-impersonating.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import {
  ListSupportRequestsQueryDto,
  SupportRequestDecisionDto,
  SupportRequestItemDto,
} from './dto/support-requests.dto';
import { SupportRequestsService } from './support-requests.service';

type Tenant = { id: string };

@ApiTags('support-access')
@ApiTenantAuth()
@Controller('support-access/requests')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
// SETTINGS_MANAGE is held by ADMIN only
@RequirePermissions(Permission.SETTINGS_MANAGE)
export class SupportRequestsController {
  constructor(private readonly requests: SupportRequestsService) {}

  @Get()
  @ApiOperation({ summary: "Biddaloy's requests to this school (pending or decided)." })
  @ApiOkResponse({ type: SupportRequestItemDto, isArray: true })
  list(@CurrentTenant() tenant: Tenant, @Query() q: ListSupportRequestsQueryDto) {
    return this.requests.list(tenant.id, q.status, q.limit);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @DenyWhenImpersonating()
  @Throttle({ default: SETTINGS_RATE_LIMIT })
  @ApiOperation({ summary: 'Approve a request. The first decision is final.' })
  @ApiOkResponse({ type: SupportRequestDecisionDto })
  approve(
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.requests.approve(tenant.id, user.sub, id, requestContext(req));
  }

  @Post(':id/deny')
  @HttpCode(200)
  @DenyWhenImpersonating()
  @Throttle({ default: SETTINGS_RATE_LIMIT })
  @ApiOperation({ summary: 'Deny a request. The first decision is final.' })
  @ApiOkResponse({ type: SupportRequestDecisionDto })
  deny(
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.requests.deny(tenant.id, user.sub, id, requestContext(req));
  }
}
