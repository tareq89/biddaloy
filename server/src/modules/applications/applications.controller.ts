import { Controller, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { ApplicationsService } from './applications.service';

/**
 * Routes that will live here (no route methods yet: a stub would change openapi.json):
 * - POST /applications, GET /applications, GET /applications/:id (52.2.1)
 * - POST /applications/:id/withdraw, /comments, /tags (52.2.1)
 * - GET /applications/addressees, /tag-options; POST /applications/letter-preview (52.2.1)
 *
 * Build the caller as `{ userId: user.sub, role: tenant.role }` from `@CurrentUser()` /
 * `@CurrentTenant()` (see leave.controller.ts).
 */
@ApiTags('applications')
@ApiTenantAuth()
@Controller('applications')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ApplicationsController {
  constructor(private readonly service: ApplicationsService) {}
}
