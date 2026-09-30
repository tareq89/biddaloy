import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  Inject,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { FamilyAccessService } from '../../students/family-access.service';
import { FinesService } from './fines.service';
import {
  LogFineDto,
  LogFineResultDto,
  WaiveFineDto,
  WaiveFineResultDto,
  QueryFinesDto,
} from './dto/fines.dto';
import { toFamilyFine } from '../dto/family.dto';
import { Permission, UserRole, isGuardianRole } from '@biddaloy/shared';
import { JwtPayload } from '@biddaloy/shared';

@ApiTags('fines')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class FinesController {
  constructor(
    @Inject(FinesService) private readonly finesService: FinesService,
    @Inject(FamilyAccessService) private readonly familyAccess: FamilyAccessService,
  ) {}

  @Post('fees/fines')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @RequirePermissions(Permission.FEE_GENERATE)
  logFine(
    @Body() dto: LogFineDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<LogFineResultDto> {
    return this.finesService.logFine(
      dto,
      tenant.id,
      user.sub,
      request as unknown as {
        headers: Record<string, string | string[] | undefined>;
        currentTenant?: { id: string };
        user?: { sub: string };
      },
    );
  }

  @Post('fees/fines/:id/waive')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.FEE_APPROVE)
  waiveFine(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WaiveFineDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<WaiveFineResultDto> {
    return this.finesService.waiveFine(
      id,
      dto,
      tenant.id,
      user.sub,
      request as unknown as {
        headers: Record<string, string | string[] | undefined>;
        currentTenant?: { id: string };
        user?: { sub: string };
      },
    );
  }

  @Get('fees/fines')
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
  )
  @RequirePermissions(Permission.FEE_READ)
  async listFines(
    @Query() query: QueryFinesDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    if (!isGuardianRole(tenant.role)) {
      return this.finesService.listFines(query, tenant.id);
    }
    const restrictToStudentIds = await this.familyAccess.getLinkedStudentIds(
      tenant.role,
      user.sub,
      tenant.id,
    );
    const page = await this.finesService.listFines(query, tenant.id, restrictToStudentIds);
    return { ...page, items: page.items.map(toFamilyFine) };
  }
}
