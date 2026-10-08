import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtPayload, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { SETTINGS_RATE_LIMIT } from '../../rate-limit';
import { OnboardingService } from './onboarding.service';
import { UpdateOnboardingDto } from './dto/onboarding.dto';
import { OnboardingStatusDto } from './dto/onboarding-status.dto';

@ApiTags('onboarding')
@ApiTenantAuth()
@Controller('onboarding')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('status')
  @ApiOperation({ summary: "How far the school's setup is, derived from real data [13.3.3]." })
  @ApiOkResponse({ type: OnboardingStatusDto })
  status(@CurrentTenant() tenant: { id: string }, @CurrentUser() user: JwtPayload) {
    return this.onboarding.getStatus(tenant.id, user.sub);
  }

  @Patch()
  @Throttle({ default: SETTINGS_RATE_LIMIT })
  @ApiOperation({
    summary: 'Record setup path / finished / dismissed / seen. Writes only schools.onboarding.',
  })
  @ApiOkResponse({ type: OnboardingStatusDto })
  update(
    @Body() dto: UpdateOnboardingDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.onboarding.update(tenant.id, user.sub, dto);
  }
}
