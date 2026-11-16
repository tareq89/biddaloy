import {
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { RequiresModule } from '../auth/decorators/require-module.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { JwtPayload, ModuleKey, Permission } from '@biddaloy/shared';
import { MarksAuthorizationService } from './marks-authorization.util';
import { MarksSmsService } from './marks-sms.service';

class MarksSmsSkippedDto {
  @ApiProperty({ format: 'uuid' }) student_id!: string;
  @ApiProperty({ enum: ['no_reachable_guardian', 'notifications_off', 'no_marks'] })
  reason!: 'no_reachable_guardian' | 'notifications_off' | 'no_marks';
}

class MarksSmsPreviewDto {
  @ApiProperty() count!: number;
  @ApiProperty() segments!: number;
  @ApiProperty({ type: [MarksSmsSkippedDto] }) skipped!: MarksSmsSkippedDto[];
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) already_sent_at!: Date | null;
}

class MarksSmsOutcomeDto {
  @ApiProperty() queued!: number;
  @ApiProperty() segments!: number;
  @ApiProperty({ type: [MarksSmsSkippedDto] }) skipped!: MarksSmsSkippedDto[];
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) already_sent_at!: Date | null;
}

type Tenant = { id: string; role: string };

/**
 * [80.3.x] D3/D25: SMS guardians the marks of one SUBMITTED section-subject grid. The permission
 * is the coarse gate; `assertCanWrite` is the object-level one (the grid's own subject teacher,
 * or a tenant-wide MARK_ENTER role). A teacher outside gets the section 404 before any grid
 * lookup, so existence never leaks. No `assertYearOpen`: this is a notification, not a marks write.
 */
@ApiTags('marks')
@ApiTenantAuth()
@RequiresModule(ModuleKey.exams)
@Controller('exams/:examId/marks/:sectionId/:subjectId/sms')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class MarksSmsController {
  constructor(
    private readonly smsService: MarksSmsService,
    private readonly authz: MarksAuthorizationService,
  ) {}

  private async gridFor(
    examId: string,
    sectionId: string,
    subjectId: string,
    tenant: Tenant,
    user: JwtPayload,
  ): Promise<string> {
    await this.authz.assertCanWrite({
      role: tenant.role,
      userId: user.sub,
      tenantId: tenant.id,
      sectionId,
      subjectId,
    });
    return this.smsService.resolveGridId(examId, sectionId, subjectId, tenant.id);
  }

  @Post('preview')
  @RequirePermissions(Permission.MARKS_SMS_SEND)
  @ApiOperation({ summary: 'Count the marks SMS a send would queue. Writes nothing.' })
  @ApiResponse({ status: 201, type: MarksSmsPreviewDto })
  async preview(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    const gridId = await this.gridFor(examId, sectionId, subjectId, tenant, user);
    return this.smsService.preview(gridId, tenant.id);
  }

  @Post()
  @RequirePermissions(Permission.MARKS_SMS_SEND)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Send marks SMS to guardians of a SUBMITTED grid.' })
  @ApiResponse({ status: 201, type: MarksSmsOutcomeDto })
  async send(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const gridId = await this.gridFor(examId, sectionId, subjectId, tenant, user);
    return this.smsService.send(gridId, tenant.id, user.sub, requestContext(request));
  }
}
