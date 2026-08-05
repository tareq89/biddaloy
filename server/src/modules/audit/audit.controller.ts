import { Controller, Get, Query, UseGuards, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { AuditService } from './audit.service';
import { QueryAuditLogDto } from './dto/audit-log.dto';
import { UserRole } from '@beton-boi/shared';

@ApiTags('audit-logs')
@ApiTenantAuth()
@Controller('audit-logs')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
export class AuditController {
  constructor(@Inject(AuditService) private readonly auditService: AuditService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary:
      "List this tenant's audit trail, newest first — filterable by action, entity type, and date range.",
  })
  findAll(@Query() query: QueryAuditLogDto, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.auditService.findAll(query, tenant.id);
  }
}
