import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ModuleKey, Permission } from '@biddaloy/shared';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { RequiresModule } from '../auth/decorators/require-module.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AdmissionRollService } from './admission-roll.service';
import {
  AssignRollsDto,
  AssignRollsResponseDto,
  StageScheduleDto,
  StageScheduleResponseDto,
} from './dto/roll.dto';

/** [71.G1.04] Roll numbers for a round and the schedule of a stage. */
@ApiTags('admission')
@ApiTenantAuth()
@Controller('admission')
@RequiresModule(ModuleKey.admission)
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.ADMISSION_REVIEW)
export class AdmissionRollController {
  constructor(private readonly rolls: AdmissionRollService) {}

  @Post('intakes/:id/rolls')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Give a roll to every fee-confirmed applicant without one. Idempotent: a repeat numbers only new applicants.',
  })
  @ApiOkResponse({ type: AssignRollsResponseDto })
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignRollsDto,
    @CurrentTenant() tenant: { id: string },
  ) {
    return this.rolls.assign(id, dto.order, tenant.id);
  }

  @Patch('stages/:id/schedule')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Set the date, start time and venue of a stage.' })
  @ApiOkResponse({ type: StageScheduleResponseDto })
  schedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StageScheduleDto,
    @CurrentTenant() tenant: { id: string },
  ) {
    return this.rolls.setSchedule(id, dto, tenant.id);
  }
}
