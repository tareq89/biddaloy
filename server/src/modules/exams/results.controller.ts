import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  Req,
  InternalServerErrorException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ApprovalGuard, ApprovalContext } from '../auth/guards/approval.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { RequireApproval } from '../auth/decorators/require-approval.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { ResultsService } from './results.service';
import { ResultSmsService } from './result-sms.service';
import { ProcessExamDto } from './dto/results.dto';
import { ApprovalScope, Permission, UserRole, JwtPayload } from '@biddaloy/shared';

@ApiTags('results')
@ApiTenantAuth()
@Controller('exams/:examId/results')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard, ApprovalGuard)
export class ResultsController {
  constructor(
    private readonly resultsService: ResultsService,
    private readonly resultSmsService: ResultSmsService,
  ) {}

  private requireApproval(request: Request): ApprovalContext {
    const approval = (request as unknown as { approval?: ApprovalContext }).approval;
    if (!approval) {
      throw new InternalServerErrorException(
        'ApprovalGuard did not run before a result reopen — @RequireApproval guard misconfigured',
      );
    }
    return approval;
  }

  @Post('process')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.RESULT_PROCESS)
  @ApiOperation({ summary: "Compute and store every enrolled student's result for this exam." })
  process(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Body() dto: ProcessExamDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.resultsService.process(
      examId,
      tenant.id,
      user.sub,
      dto.force ?? false,
      requestContext(request),
    );
  }

  @Post('publish')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.RESULT_PUBLISH)
  @ApiOperation({ summary: "Publish a processed exam's results (PROCESSED -> PUBLISHED)." })
  async publish(
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    await this.resultsService.publish(examId, tenant.id, user.sub, requestContext(request));
    return { published: true };
  }

  @Post('reopen')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.RESULT_PUBLISH)
  @RequireApproval(ApprovalScope.RESULTS_REOPEN)
  @ApiOperation({
    summary:
      "Reopen a published exam's results (PUBLISHED -> PROCESSED). Step-up approval required.",
  })
  async reopen(
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const approval = this.requireApproval(request);
    await this.resultsService.reopen(
      examId,
      tenant.id,
      user.sub,
      requestContext(request),
      approval,
    );
    return { reopened: true };
  }

  @Post('sms')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.RESULT_PUBLISH)
  @ApiOperation({ summary: "Send every guardian their child's published result by SMS." })
  sendSms(
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.resultSmsService.sendForExam(examId, tenant.id, user.sub, requestContext(request));
  }
}
