import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApprovalScope } from '@biddaloy/shared';
import { RequireApproval } from '../../auth/decorators/require-approval.decorator';
import { ApprovalGuard } from '../../auth/guards/approval.guard';
import type { CockpitPrincipal } from '../../platform-identity/cockpit-principal';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import {
  CreateSmsPackageDto,
  ListSmsPackagesQueryDto,
  SetSmsPackageActiveDto,
  SmsPackageDto,
  UpdateSmsPackageDto,
} from './dto/sms-bundle-catalog.dto';
import { SmsBundleCatalogService, type CatalogActor } from './sms-bundle-catalog.service';

type CockpitReq = Request & { user: CockpitPrincipal; approval?: { approverId: string } };
const actor = (req: CockpitReq): CatalogActor => ({
  userId: req.user.sub,
  approverId: req.approval?.approverId,
  ip: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

/** [100.2.02] The owner's SMS package catalog. No delete: orders reference packages. */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/sms-packages')
@UseGuards(AuthGuard('cockpit-jwt'), PlatformAdminGuard)
export class PlatformSmsCatalogController {
  constructor(private readonly catalog: SmsBundleCatalogService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'All packages, active and off.' })
  list(@Query() q: ListSmsPackagesQueryDto): Promise<SmsPackageDto[]> {
    return this.catalog.listAll(q.limit);
  }

  @Post()
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_PLAN)
  @ApiOperation({ summary: 'Create a package. Needs a step-up token.' })
  create(@Body() dto: CreateSmsPackageDto, @Req() req: CockpitReq): Promise<SmsPackageDto> {
    return this.catalog.create(dto, actor(req));
  }

  @Patch(':id')
  @UseGuards(ApprovalGuard)
  @RequireApproval(ApprovalScope.PLATFORM_PLAN)
  @ApiOperation({ summary: 'Edit a package. Needs a step-up token.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSmsPackageDto,
    @Req() req: CockpitReq,
  ): Promise<SmsPackageDto> {
    return this.catalog.update(id, dto, actor(req));
  }

  @Post(':id/active')
  @ApiOperation({ summary: 'Switch a package on or off. No step-up (it only narrows sales).' })
  setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetSmsPackageActiveDto,
    @Req() req: CockpitReq,
  ): Promise<SmsPackageDto> {
    return this.catalog.setActive(id, dto.active, actor(req));
  }
}
