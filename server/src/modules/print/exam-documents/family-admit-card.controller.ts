import {
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtPayload, Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { FamilyAccessService } from '../../students/family-access.service';
import { FamilyAdmitCardService } from './family-admit-card.service';
import { STRICT_RATE_LIMIT } from '../../../rate-limit';

/** [48.2.09] Portal self-print. Mirrors `StudentExamScheduleController` (assertLinked first). */
@ApiTags('exam-documents')
@ApiTenantAuth()
@Controller('students/:studentId/exams/:examId/admit-card')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class FamilyAdmitCardController {
  constructor(
    private readonly service: FamilyAdmitCardService,
    private readonly familyAccess: FamilyAccessService,
  ) {}

  @Post()
  @HttpCode(200)
  // Each call mints a job, a verify token and an audit row: cap it per user.
  @Throttle({ default: STRICT_RATE_LIMIT })
  @RequirePermissions(Permission.RESULT_READ)
  @ApiOperation({
    summary:
      "Print the student's own admit card (PARENT/STUDENT, linkage-checked). Each call is a logged copy.",
  })
  async print(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    await this.familyAccess.assertLinked(tenant.role, user.sub, studentId, tenant.id);
    return this.service.print(tenant, user.sub, studentId, examId);
  }

  @Get('assets/:assetId/file')
  @RequirePermissions(Permission.RESULT_READ)
  // Same headers as the staff `GET /print-assets/:id/file`.
  @Header('Cache-Control', 'private, max-age=31536000, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  @ApiOperation({
    summary: 'Artwork/font bytes of the default admit-card template (linked family).',
  })
  async assetFile(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('examId', ParseUUIDPipe) examId: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    await this.familyAccess.assertLinked(tenant.role, user.sub, studentId, tenant.id);
    const { asset, object } = await this.service.assetFile(tenant, studentId, examId, assetId);
    res.setHeader('Content-Type', asset.content_type);
    return new StreamableFile(object.body);
  }
}
