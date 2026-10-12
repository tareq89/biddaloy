import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AdmissionDocumentType, Permission } from '@biddaloy/shared';
import { requestContext } from '../../common/request-context.util';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
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

  @Get(':id/guardian-match')
  @ApiOperation({
    summary: "The existing guardian this applicant's phone matches, with their children (or null).",
  })
  guardianMatch(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.review.guardianMatch(id, tenant.id);
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

  @Get(':id/documents/:type')
  @ApiOperation({ summary: 'Stream one uploaded document. Tenant-scoped; 404 across tenants.' })
  async document(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('type', new ParseEnumPipe(AdmissionDocumentType)) type: AdmissionDocumentType,
    @CurrentTenant() tenant: { id: string; role: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const object = await this.review.getDocument(id, type, tenant.id);
    // Documents can be deleted, so never cache; nosniff + sandbox for uploaded content.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Content-Type', object.contentType ?? 'application/octet-stream');
    return new StreamableFile(object.body);
  }

  @Delete(':id/documents')
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a REJECTED applicant's uploaded documents (rows + storage)." })
  async deleteDocuments(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<void> {
    await this.review.deleteDocuments(id, tenant.id, user.sub, requestContext(request));
  }
}
