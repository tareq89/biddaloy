import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { FineRulesService } from './fine-rules.service';
import {
  CreateFineRuleDto,
  UpdateFineRuleDto,
  CopyFineRulesDto,
  toFineRuleDto,
} from './dto/fine-rules.dto';
import { JwtPayload, Permission, UserRole } from '@biddaloy/shared';

/**
 * [38.2.1] `FineRule` CRUD + copy-from-last-year. Not wired into
 * `fees.module.ts` yet — that's 38.2.5 (#1117); this controller has no
 * route until then, so it isn't exercised by `permission-matrix.e2e-spec.ts`
 * in this ticket.
 */
@ApiTags('fine-rules')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class FineRulesController {
  constructor(private readonly fineRulesService: FineRulesService) {}

  @Get('fees/fine-rules')
  // [38.2.5] Matches the FEE_STRUCTURE_READ holders exactly (ADMIN,
  // ACCOUNTANT — see shared/src/enums/permissions.ts): EXECUTIVE and
  // TEACHER don't hold it (same "stays off the Finance nav" call as
  // fee-structures' own GETs), so listing them in `@Roles` here would only
  // fail `PermissionsGuard` at runtime and trip permission-matrix's [10.4]
  // narrowing check.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.FEE_STRUCTURE_READ)
  @ApiOperation({ summary: "List a tenant's fine rules for one academic year." })
  async list(
    @Query('academic_year_id', ParseUUIDPipe) academicYearId: string,
    @CurrentTenant() tenant: { id: string },
  ) {
    const rules = await this.fineRulesService.list(tenant.id, academicYearId);
    return rules.map(toFineRuleDto);
  }

  @Post('fees/fine-rules')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.FEE_STRUCTURE_CREATE)
  @ApiOperation({ summary: 'Create a fine rule.' })
  async create(
    @Body() dto: CreateFineRuleDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const rule = await this.fineRulesService.create(tenant.id, user.sub, dto);
    return toFineRuleDto(rule);
  }

  @Patch('fees/fine-rules/:id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.FEE_STRUCTURE_UPDATE)
  @ApiOperation({ summary: 'Update a fine rule, including activating/deactivating it.' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFineRuleDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const rule = await this.fineRulesService.update(tenant.id, id, user.sub, dto);
    return toFineRuleDto(rule);
  }

  @Delete('fees/fine-rules/:id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.FEE_STRUCTURE_DELETE)
  @ApiOperation({ summary: 'Soft-delete a fine rule.' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
  ): Promise<{ deleted: true }> {
    await this.fineRulesService.remove(tenant.id, id, user.sub);
    return { deleted: true };
  }

  @Post('fees/fine-rules/copy')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.FEE_STRUCTURE_CREATE)
  @ApiOperation({
    summary:
      'Copy fine rules (and the FINE fee structures they point at) from one academic year to another. Idempotent — a second run reports everything as skipped.',
  })
  async copy(
    @Body() dto: CopyFineRulesDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.fineRulesService.copy(tenant.id, user.sub, dto);
  }
}
