import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DeviceAuthGuard } from './device-auth.guard';
import { CurrentDevice } from './current-device.decorator';
import { AttendanceDevice } from '../entities/attendance-device.entity';
import { DeviceEventsService } from './device-events.service';
import {
  DeviceEventBatchDto,
  DeviceEventBatchResponseDto,
  DeviceHeartbeatResponseDto,
  DeviceRosterEntryDto,
} from '../dto/device.dto';

/** Sized for a busy gate — 120 requests per minute per device. Keyed on
 * the device (see `buildRateLimitTracker`), not the IP: every device
 * behind one school's NAT shares an IP. */
const DEVICE_INGEST_RATE_LIMIT = { limit: 120, ttl: 60_000 };

/**
 * The device's own credential-authenticated surface — `X-Device-Key` only,
 * no JWT, no user, no tenant header. Tenant is resolved from the device
 * row by `DeviceAuthGuard`; `RolesGuard` is deliberately absent because a
 * device holds no `UserRole`. See [9.5] and the `route-guard-coverage`
 * allowlist entries for these three routes.
 */
@ApiTags('attendance-devices')
@ApiHeader({ name: 'X-Device-Key', required: true, description: "The device's credential." })
@Controller('attendance')
@UseGuards(DeviceAuthGuard)
export class DeviceIngestController {
  constructor(private readonly deviceEventsService: DeviceEventsService) {}

  @Post('device-events')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: DEVICE_INGEST_RATE_LIMIT })
  @ApiOperation({
    summary:
      'Batch-ingests raw scans from a device. Not atomic — one bad event never fails the rest.',
  })
  @ApiOkResponse({ type: DeviceEventBatchResponseDto })
  async ingest(@Body() dto: DeviceEventBatchDto, @CurrentDevice() device: AttendanceDevice) {
    return this.deviceEventsService.ingest(device, dto.events);
  }

  @Get('devices/me/roster')
  @ApiOperation({
    summary:
      "The device's own section roster — exactly five fields, never the whole Student record.",
  })
  @ApiOkResponse({ type: DeviceRosterEntryDto, isArray: true })
  async roster(
    @Query('section_id') sectionId: string | undefined,
    @CurrentDevice() device: AttendanceDevice,
  ) {
    return this.deviceEventsService.getRoster(device, sectionId);
  }

  @Post('devices/me/heartbeat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Lets a device align its own clock and screen against the tenant's policy.",
  })
  @ApiOkResponse({ type: DeviceHeartbeatResponseDto })
  async heartbeat(@CurrentDevice() device: AttendanceDevice) {
    return this.deviceEventsService.heartbeat(device);
  }
}
