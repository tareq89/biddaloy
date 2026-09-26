import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import type { JwtPayload } from '@biddaloy/shared';
import { ApplicantReviewService } from './applicant-review.service';
import { EvaluateApplicantDto } from './dto/evaluate-applicant.dto';
import { AdmitApplicantDto } from './dto/admit-applicant.dto';
import { ListApplicantsDto } from './dto/list-applicants.dto';

/** [27.5] Staff review/evaluate/admit/reject over `admission_applicants` —
 * same guard stack as `IntakeController` (#27.3). */
@ApiTags('admission')
@ApiTenantAuth()
@Controller('admission/applicants')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermissions(Permission.ADMISSION_REVIEW)
export class ApplicantReviewController {
  constructor(private readonly review: ApplicantReviewService) {}

  @Get()
  @ApiOperation({
    summary: 'List admission applicants, optionally filtered by intake and/or status.',
  })
  findAll(
    @Query() filters: ListApplicantsDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.review.list(tenant.id, filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one applicant plus its evaluation history.' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.review.findWithHistory(id, tenant.id);
  }

  @Post(':id/evaluate')
  @ApiOperation({ summary: 'Record an evaluation note, optionally shortlisting or rejecting.' })
  evaluate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EvaluateApplicantDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.review.evaluate(id, dto, tenant.id, user.sub);
  }

  @Post(':id/admit')
  @ApiOperation({ summary: 'Admit an applicant, converting them to a Student + Guardian.' })
  admit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdmitApplicantDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.review.admit(id, dto, tenant.id, user.sub);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject an applicant. No student record is created.' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdmitApplicantDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.review.reject(id, tenant.id, user.sub, dto.notes);
  }
}
