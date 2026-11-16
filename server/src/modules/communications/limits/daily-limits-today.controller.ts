import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';
import {
  CommunicationMedium,
  Permission,
  type DailyLimitChannel,
  type DailyLimitsToday,
} from '@biddaloy/shared';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { CommunicationProviderRegistryService } from '../providers/communication-provider.registry';
import { SendLimitService } from './send-limit.service';

const MEDIA: [DailyLimitChannel, CommunicationMedium][] = [
  ['sms', CommunicationMedium.SMS],
  ['email', CommunicationMedium.EMAIL],
  ['whatsapp', CommunicationMedium.WHATSAPP],
];

class DailyLimitsTodayDto implements DailyLimitsToday {
  @ApiProperty() show!: boolean;
  @ApiProperty({
    type: 'object',
    additionalProperties: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        used: { type: 'number' },
        left: { type: 'number' },
      },
    },
  })
  channels!: DailyLimitsToday['channels'];
}

/** [60.0 D33] The optional "left today" notice. Declared before `CommunicationsController` (`:id`). */
@ApiTags('communications')
@ApiTenantAuth()
@Controller('communications/daily-limits')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class DailyLimitsTodayController {
  constructor(
    private readonly limits: SendLimitService,
    private readonly registry: CommunicationProviderRegistryService,
  ) {}

  @Get('today')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(Permission.COMMUNICATION_SEND)
  @ApiOperation({
    summary: 'Messages left today on the platform account, only when the owner switched it on.',
  })
  @ApiOkResponse({ type: DailyLimitsTodayDto })
  async today(@CurrentTenant() tenant: { id: string }): Promise<DailyLimitsToday> {
    try {
      if (!(await this.limits.effective(tenant.id)).showRemaining) {
        return { show: false, channels: {} };
      }
      const channels: DailyLimitsToday['channels'] = {};
      for (const [key, medium] of MEDIA) {
        // Only sends on the platform account are counted (D16): own gateway = not listed.
        const { source } = await this.registry
          .resolveFor(medium, tenant.id)
          .catch(() => ({ source: undefined }));
        if (source !== 'platform') continue;
        const { limit, remaining } = await this.limits.remaining(tenant.id, medium);
        channels[key] = { limit, used: limit - remaining, left: remaining };
      }
      return { show: true, channels };
    } catch (err) {
      // Same fail-open as D8: the notice is optional, never an error page.
      Sentry.captureException(err);
      return { show: false, channels: {} };
    }
  }
}
