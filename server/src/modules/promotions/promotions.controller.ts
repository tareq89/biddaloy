import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Inject,
  ParseArrayPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { PromotionsService } from './promotions.service';
import { FamilyAccessService } from '../students/family-access.service';
import {
  CreatePromotionRunDto,
  PatchPromotionEntryDto,
  SuggestTargetQueryDto,
  ListPromotionRunsQueryDto,
} from './dto/promotions.dto';
import { Permission, UserRole, JwtPayload } from '@biddaloy/shared';

@ApiTags('promotions')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class PromotionsController {
  constructor(
    private readonly service: PromotionsService,
    @Inject(FamilyAccessService) private readonly familyAccess: FamilyAccessService,
  ) {}

  // [26.1.1] Backs the D12 badge on the student detail page — same
  // permission AND the same object-level gate the student detail route
  // itself uses (assertLinked), so students/ stays untouched (D12 note on
  // the ticket) while a PARENT/STUDENT caller still can't read another
  // student's override notes by guessing UUIDs.
  @Get('students/:studentId/promotion-overrides')
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
  )
  @RequirePermissions(Permission.STUDENT_READ)
  async findStudentOverrides(
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    await this.familyAccess.assertLinked(tenant.role, user.sub, studentId, tenant.id);
    return this.service.findStudentOverrides(studentId, tenant.id);
  }

  @Get('promotions/suggest-target')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.PROMOTION_MANAGE)
  suggestTarget(
    @Query() query: SuggestTargetQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.suggestTarget(query.source_class_id, query.target_academic_year_id, tenant.id);
  }

  @Post('promotions')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.PROMOTION_MANAGE)
  create(
    @Body() dto: CreatePromotionRunDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.create(dto, tenant.id, user.sub);
  }

  @Patch('promotions/:id/entries')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.PROMOTION_MANAGE)
  patchEntries(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ParseArrayPipe({ items: PatchPromotionEntryDto }))
    entries: PatchPromotionEntryDto[],
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.patchEntries(id, entries, tenant.id, user.sub);
  }

  @Post('promotions/:id/refresh')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.PROMOTION_MANAGE)
  refresh(@Param('id', new ParseUUIDPipe()) id: string, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.service.refresh(id, tenant.id);
  }

  @Delete('promotions/:id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.PROMOTION_MANAGE)
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.service.remove(id, tenant.id);
  }

  @Get('promotions')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.PROMOTION_MANAGE)
  list(@Query() query: ListPromotionRunsQueryDto, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.service.list(tenant.id, query.source_class_id);
  }

  @Get('promotions/:id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.PROMOTION_MANAGE)
  findOne(@Param('id', new ParseUUIDPipe()) id: string, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.service.findOne(id, tenant.id);
  }

  // [26.1.1] Approval for the override step-up is consumed *conditionally*
  // inside the service (only when override_count > 0), the same pattern
  // fee-generation.service.ts's duplicate-override consume uses — so no
  // @RequireApproval here; ApprovalGuard would demand a token on every
  // commit, including the common no-override case.
  @Post('promotions/:id/commit')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.PROMOTION_MANAGE)
  async commit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    await this.service.commit(
      id,
      tenant.id,
      user.sub,
      tenant.role,
      request as unknown as {
        headers: Record<string, string | string[] | undefined>;
        currentTenant?: { id: string };
        user?: { sub: string };
      },
      requestContext(request),
    );
    return this.service.findOne(id, tenant.id);
  }
}
