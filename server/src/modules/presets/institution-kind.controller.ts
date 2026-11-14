import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtPayload, Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { requestContext } from '../../common/request-context.util';
import { InstitutionKindService } from './institution-kind.service';
import { InstitutionKindChangesDto, InstitutionKindDto } from './dto/apply-institution-kind.dto';

/** [77.4.1] D23/D24/D43/D44. `:id` is a slug checked against the shared list (400, fixed text). */
@ApiTags('presets')
@ApiTenantAuth()
@Controller('institution-kinds')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class InstitutionKindController {
  constructor(private readonly kinds: InstitutionKindService) {}

  @Get()
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'The institution kinds with their module switches and words.' })
  @ApiOkResponse({ type: [InstitutionKindDto] })
  list(): InstitutionKindDto[] {
    return this.kinds.list() as unknown as InstitutionKindDto[];
  }

  @Post(':id/preview')
  @HttpCode(HttpStatus.OK) // read-only despite POST
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'What applying a kind would change. Writes nothing.' })
  @ApiOkResponse({ type: InstitutionKindChangesDto })
  preview(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string },
  ): Promise<InstitutionKindChangesDto> {
    return this.kinds.preview(tenant.id, id);
  }

  @Post(':id/apply')
  @UseInterceptors(IdempotencyInterceptor)
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @ApiOperation({
    summary:
      'Apply a kind: overwrites the school module switches and words it defines. Keeps platform locks, role-offs and data.',
  })
  @ApiOkResponse({ type: InstitutionKindChangesDto })
  apply(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<InstitutionKindChangesDto> {
    return this.kinds.apply(tenant.id, user.sub, id, requestContext(request));
  }
}
