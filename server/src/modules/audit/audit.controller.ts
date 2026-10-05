import { Controller, Get, Param, Query, UseGuards, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { AuditService } from './audit.service';
import { QueryAuditLogDto } from './dto/audit-log.dto';
import { AuditLogListResponseDto, AuditLogResponseDto } from './dto/audit-log-response.dto';
import { Permission } from '@biddaloy/shared';

@ApiTags('audit-logs')
@ApiTenantAuth()
@Controller('audit-logs')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class AuditController {
  constructor(@Inject(AuditService) private readonly auditService: AuditService) {}

  @Get()
  @RequirePermissions(Permission.AUDIT_LOG_READ)
  @ApiOperation({
    summary:
      "List this tenant's audit trail, newest first — filterable by action, entity type, and date range.",
  })
  @ApiResponse({ status: 200, type: AuditLogListResponseDto })
  async findAll(
    @Query() query: QueryAuditLogDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    const { entityLabels, ...result } = await this.auditService.findAll(query, tenant.id, user.sub);
    return {
      ...result,
      data: result.data.map((log) => ({
        ...AuditLogResponseDto.fromEntity(log),
        entity_label: entityLabels.get(`${log.entity_type}:${log.entity_id}`) ?? null,
      })),
    };
  }

  // Declared before `findAll`'s `@Get()` shares no path segment with it, so
  // ordering doesn't matter for routing — kept below it just to read as
  // "the tenant-wide view, then the narrower one" top to bottom.
  @Get('entity/:entityType/:entityId')
  // [10.4] G6 — per-entity Activity tab; object-scoped, distinct from the
  // tenant-wide AUDIT_LOG_READ above.
  @RequirePermissions(Permission.AUDIT_ENTITY_HISTORY_READ)
  @ApiOperation({
    summary: "List one entity's audit trail (e.g. a single student's activity tab), newest first.",
  })
  @ApiResponse({ status: 200, type: AuditLogListResponseDto })
  async findByEntity(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Query() query: QueryAuditLogDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    const result = await this.auditService.findByEntity(
      entityType,
      entityId,
      query,
      tenant.id,
      user.sub,
    );
    return { ...result, data: result.data.map(AuditLogResponseDto.fromEntity) };
  }
}
