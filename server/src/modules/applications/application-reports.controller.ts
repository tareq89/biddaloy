import { Controller, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { ApplicationReportsService } from './application-reports.service';

/**
 * Routes that will live here (no route methods yet: a stub would change openapi.json):
 * - GET /applications/pending-count (52.3.5)
 * - GET /applications/reports (52.3.5)
 *
 * Build the caller as `{ userId: user.sub, role: tenant.role }` from `@CurrentUser()` /
 * `@CurrentTenant()` (see leave.controller.ts).
 */
@ApiTags('applications')
@ApiTenantAuth()
@Controller('applications')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ApplicationReportsController {
  constructor(private readonly service: ApplicationReportsService) {}
}
