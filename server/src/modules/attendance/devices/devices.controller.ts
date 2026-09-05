import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { DeviceService } from './device.service';
import { CreateDeviceDto, DeviceResponseDto, DeviceWithKeyResponseDto } from '../dto/device.dto';

/**
 * Device management — admin-only, ordinary JWT guard stack. The device's
 * own credential-authenticated routes (`POST /attendance/device-events`,
 * `GET /attendance/devices/me/roster`, `POST /attendance/devices/me/heartbeat`)
 * live in `device-ingest.controller.ts` instead, behind `DeviceAuthGuard`.
 */
@ApiTags('attendance-devices')
@ApiTenantAuth()
@Controller('attendance/devices')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
export class DevicesController {
  constructor(private readonly deviceService: DeviceService) {}

  @Post()
  @ApiOperation({
    summary: 'Registers a new device. The raw key is returned exactly once, in this response.',
  })
  @ApiOkResponse({ type: DeviceWithKeyResponseDto })
  async create(
    @Body() dto: CreateDeviceDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
    @Req() req: Request,
  ) {
    return this.deviceService.create({
      tenantId: tenant.id,
      userId: user.sub,
      dto,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Get()
  @ApiOperation({ summary: "The tenant's registered devices. Never includes a key or its hash." })
  @ApiOkResponse({ type: DeviceResponseDto, isArray: true })
  async list(@CurrentTenant() tenant: { id: string; role: string }) {
    return this.deviceService.list(tenant.id);
  }

  @Post(':id/rotate')
  @ApiOperation({
    summary: 'Issues a new key for this device. The old key stops working immediately.',
  })
  @ApiOkResponse({ type: DeviceWithKeyResponseDto })
  async rotate(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
    @Req() req: Request,
  ) {
    return this.deviceService.rotate({
      tenantId: tenant.id,
      deviceId: id,
      userId: user.sub,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revokes a device. Sets status to REVOKED — never a hard delete.',
  })
  async revoke(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
    @Req() req: Request,
  ) {
    await this.deviceService.revoke({
      tenantId: tenant.id,
      deviceId: id,
      userId: user.sub,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }
}
