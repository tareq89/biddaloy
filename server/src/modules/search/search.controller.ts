import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { SearchService } from './search.service';
import { SearchQueryDto, SearchResultsDto } from './dto/search.dto';

/** `GET /search` — [30.2.1]'s unified palette query. Staff-only
 * (`ADMIN`/`ACCOUNTANT`/`EXECUTIVE`/`TEACHER`), same as the directory
 * routes it replaces (`GET /students`, `GET /guardians`): `STUDENT_READ`,
 * `GUARDIAN_READ`, `INVOICE_READ` and `PAYMENT_READ` are all
 * *object-scoped* permissions that `PARENT`/`STUDENT` also hold (see
 * `Permission.STUDENT_READ`'s own doc comment in `@biddaloy/shared`) —
 * this endpoint has no per-object ownership check the way
 * `GET /students/mine` does, so admitting those roles here would let a
 * guardian search every family's students/guardians/invoices/payments in
 * the tenant, not just their own. `@Roles` below deliberately narrows
 * below what `@RequirePermissions(STUDENT_READ)` alone would admit —
 * documented as a `ROLE_NARROWINGS` entry in
 * `permission-matrix.e2e-spec.ts` alongside `GET /students`/`GET /guardians`.
 *
 * `@RequirePermissions(STUDENT_READ)` is only the route-level floor —
 * which of the five result groups actually comes back is decided again,
 * per-group, inside `SearchService.search` against the caller's resolved
 * role, before any row leaves the service. */
@ApiTags('search')
@ApiTenantAuth()
@Controller('search')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @RequirePermissions(Permission.STUDENT_READ)
  @ApiOperation({
    summary:
      "Unified palette search across students, guardians, staff, invoices and payments; each group's own permission decides whether it appears at all.",
  })
  @ApiOkResponse({ type: SearchResultsDto })
  async search(
    @Query() query: SearchQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<SearchResultsDto> {
    return this.searchService.search(tenant.id, tenant.role as UserRole, query);
  }
}
