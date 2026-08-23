import { Controller, Get, Param, Query, UseGuards, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { AuditService } from './audit.service';
import { QueryAuditLogDto } from './dto/audit-log.dto';
import { AuditLogListResponseDto, AuditLogResponseDto } from './dto/audit-log-response.dto';
import { UserRole } from '@biddaloy/shared';

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
  @ApiResponse({ status: 200, type: AuditLogListResponseDto })
  async findAll(
    @Query() query: QueryAuditLogDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const result = await this.auditService.findAll(query, tenant.id);
    return { ...result, data: result.data.map(AuditLogResponseDto.fromEntity) };
  }

  // Declared before `findAll`'s `@Get()` shares no path segment with it, so
  // ordering doesn't matter for routing — kept below it just to read as
  // "the tenant-wide view, then the narrower one" top to bottom.
  @Get('entity/:entityType/:entityId')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @ApiOperation({
    summary: "List one entity's audit trail (e.g. a single student's activity tab), newest first.",
  })
  @ApiResponse({ status: 200, type: AuditLogListResponseDto })
  async findByEntity(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Query() query: QueryAuditLogDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const result = await this.auditService.findByEntity(entityType, entityId, query, tenant.id);
    return { ...result, data: result.data.map(AuditLogResponseDto.fromEntity) };
  }
}
