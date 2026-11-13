import { Body, Controller, Get, HttpCode, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsIn } from 'class-validator';
import type { Request } from 'express';
import { JwtPayload, Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { DenyWhenImpersonating } from '../../auth/decorators/deny-when-impersonating.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../../common/request-context.util';
import { SETTINGS_RATE_LIMIT } from '../../../rate-limit';
import { SmsSourceService } from './sms-source.service';
import { SMS_SOURCES, type SmsSource } from './sms-source.util';

export class SetSmsSourceDto {
  @ApiProperty({ enum: SMS_SOURCES })
  @IsIn(SMS_SOURCES)
  source!: SmsSource;
}

export class SmsSourceDto {
  @ApiProperty({ enum: SMS_SOURCES }) source!: SmsSource;
  @ApiProperty() ownProviderSaved!: boolean;
}

@ApiTags('communications')
@ApiTenantAuth()
@Controller('communications/sms-source')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.SETTINGS_MANAGE)
export class SmsSourceController {
  constructor(private readonly service: SmsSourceService) {}

  @Get()
  @ApiOperation({ summary: "Who provides this school's SMS: its own company or SchoolManagerP." })
  @ApiOkResponse({ type: SmsSourceDto })
  get(@CurrentTenant() tenant: { id: string }) {
    return this.service.get(tenant.id);
  }

  @DenyWhenImpersonating()
  @Put()
  @HttpCode(200)
  @Throttle({ default: SETTINGS_RATE_LIMIT })
  @ApiOperation({ summary: 'Switch SMS between the own provider and SchoolManagerP.' })
  @ApiOkResponse({ type: SmsSourceDto })
  set(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetSmsSourceDto,
    @Req() request: Request,
  ) {
    return this.service.set(tenant.id, dto.source, user.sub, requestContext(request));
  }
}
