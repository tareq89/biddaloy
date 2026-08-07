import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@beton-boi/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { PROVIDER_TEST_RATE_LIMIT } from '../../../rate-limit';
import { assertCanManageSchool } from '../../schools/assert-can-manage-school.util';
import { ConnectionTestService } from './connection-test.service';
import { TestConnectionDto } from '../dto/test-connection.dto';

/**
 * `POST /schools/:id/settings/test` (#8.7.12) — lives in
 * `CommunicationsModule`, not `SchoolsModule`, purely because that's where
 * the 4 providers already are; the route path is still `/schools/...`,
 * same permission (`assertCanManageSchool`) and tenant-scope rules as
 * `SchoolsController`'s settings endpoints (#8.7.9). `SchoolsModule`
 * already can't import `CommunicationsModule` back (it would be
 * circular — `CommunicationsModule` imports `SchoolsModule` for
 * `TenantProviderConfigResolver`'s dependencies since #8.7.10), so the
 * controller has to live on this side.
 */
@ApiTags('schools')
@ApiTenantAuth()
@Controller('schools')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
export class ProviderConnectionTestController {
  constructor(private readonly connectionTest: ConnectionTestService) {}

  @Post(':id/settings/test')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  // Tighter than settings GET/PATCH's STRICT_RATE_LIMIT — this is the one
  // endpoint that makes a real outbound call to a third party per request.
  @Throttle({ default: PROVIDER_TEST_RATE_LIMIT })
  @ApiOperation({
    summary:
      "Test a communications provider's credentials (SMS/WhatsApp/Email/Messenger) using the provider's cheapest verification call — never sends a real message. Pass `config` to test unsaved values before saving them; omitted fields fall back to what's already stored for this school.",
  })
  async testConnection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TestConnectionDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    assertCanManageSchool(tenant, id);
    return this.connectionTest.test(id, dto.medium, dto.config);
  }
}
