import { Controller, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { ApplicationDecisionsService } from './application-decisions.service';

/**
 * Routes that will live here (no route methods yet: a stub would change openapi.json):
 * - POST /applications/:id/approve, /reject, /consider, /cancel (52.3.1)
 * - POST /applications/bulk-approve (52.3.1)
 *
 * Build the caller as `{ userId: user.sub, role: tenant.role }` from `@CurrentUser()` /
 * `@CurrentTenant()` (see leave.controller.ts).
 */
@ApiTags('applications')
@ApiTenantAuth()
@Controller('applications')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ApplicationDecisionsController {
  constructor(private readonly service: ApplicationDecisionsService) {}
}
