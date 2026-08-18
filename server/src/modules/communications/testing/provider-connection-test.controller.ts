import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuditAction, JwtPayload, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { PROVIDER_TEST_RATE_LIMIT } from '../../../rate-limit';
import { requestContext } from '../../../common/request-context.util';
import { assertCanManageSchool } from '../../schools/assert-can-manage-school.util';
import { AuditService } from '../../audit/audit.service';
import { ConnectionTestService } from './connection-test.service';
import { TestConnectionDto } from '../dto/test-connection.dto';
import { ConnectionTestResultDto } from './connection-test-result.dto';

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
  constructor(
    private readonly connectionTest: ConnectionTestService,
    private readonly auditService: AuditService,
  ) {}

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
  @ApiOkResponse({ type: ConnectionTestResultDto })
  @ApiForbiddenResponse({
    description:
      'An ADMIN attempted to manage a school other than their own; only a SUPER_ADMIN can manage any school.',
  })
  async testConnection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TestConnectionDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    assertCanManageSchool(tenant, id);
    const result = await this.connectionTest.test(id, dto.medium, dto.config);

    // This handler decrypts a school's stored provider credentials and
    // sends them to a third party — the same credential material
    // SchoolsController.updateSettings already logs a SETTINGS_CHANGE
    // entry for, but this endpoint had no audit trail at all. Never the
    // submitted config or the provider's result message, both of which
    // can carry secret-adjacent detail — only who tested what, and
    // whether it passed.
    await this.auditService.record({
      action: AuditAction.SETTINGS_TEST,
      entity_type: 'School',
      entity_id: id,
      tenant_id: id,
      performed_by_user_id: user.sub,
      ip_address: requestContext(request).ip,
      user_agent: requestContext(request).userAgent,
      new_values: { medium: dto.medium, success: result.success },
    });

    return result;
  }
}
