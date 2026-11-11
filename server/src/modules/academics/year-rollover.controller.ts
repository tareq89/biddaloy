import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtPayload, Permission, YEAR_ROLLOVER_BLOCKS } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { YearRolloverService } from './year-rollover.service';
import { YearRolloverDto } from './dto/year-rollover.dto';

/** [69.2.02] Year rollover routes (D13). ADMIN only, via ACADEMIC_YEAR_MANAGE. */
@ApiTags('academic-years')
@ApiTenantAuth()
@Controller('academic-years')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class YearRolloverController {
  constructor(@Inject(YearRolloverService) private readonly service: YearRolloverService) {}

  @Get(':id/next/preview')
  @RequirePermissions(Permission.ACADEMIC_YEAR_MANAGE)
  @ApiOperation({ summary: 'Dry-run: what creating the next year would copy. Writes nothing.' })
  preview(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() dto: YearRolloverDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.preview(tenant.id, id, {
      ...dto,
      include: dto.include ?? [...YEAR_ROLLOVER_BLOCKS],
    });
  }

  @Post(':id/next')
  @RequirePermissions(Permission.ACADEMIC_YEAR_MANAGE)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Create the next year and copy the chosen blocks, all or nothing.' })
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: YearRolloverDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.create(
      tenant.id,
      user.sub,
      id,
      { ...dto, include: dto.include ?? [...YEAR_ROLLOVER_BLOCKS] },
      requestContext(request),
    );
  }
}
