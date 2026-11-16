import {
  Body,
  Controller,
  BadRequestException,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ModuleKey, Permission, type JwtPayload } from '@biddaloy/shared';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { requestContext } from '../../common/request-context.util';
import { RequiresModule } from '../auth/decorators/require-module.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AdmissionPublicationService } from './admission-publication.service';
import {
  CallListQueryDto,
  CallListRowDto,
  AdmissionPublishDto,
  PublishEstimateQueryDto,
  PublishEstimateResponseDto,
  PublishResponseDto,
  SetCalledDto,
  SetCalledResponseDto,
} from './dto/admission-publication.dto';

/** [#4184] Publish a result or list, SMS estimate, call list. */
@ApiTags('admission')
@ApiTenantAuth()
@Controller('admission')
@RequiresModule(ModuleKey.admission)
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.ADMISSION_REVIEW)
export class AdmissionPublicationController {
  constructor(private readonly publication: AdmissionPublicationService) {}

  private actor(user: JwtPayload, request: Request) {
    const ctx = requestContext(request);
    return { userId: user.sub, ip: ctx.ip, userAgent: ctx.userAgent };
  }

  @Post('intakes/:id/publish')
  @HttpCode(200)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary:
      'Publish a stage result or a list: set the public flag and SMS the right guardians. Needs an Idempotency-Key.',
  })
  @ApiOkResponse({ type: PublishResponseDto })
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdmissionPublishDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey) throw new BadRequestException('Idempotency-Key header is required.');
    return this.publication.publish(id, dto, tenant.id, this.actor(user, request));
  }

  @Get('intakes/:id/publish/estimate')
  @ApiOperation({ summary: 'How many SMS (and credits) a publish would send.' })
  @ApiOkResponse({ type: PublishEstimateResponseDto })
  estimate(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PublishEstimateQueryDto,
    @CurrentTenant() tenant: { id: string },
  ) {
    return this.publication.estimate(
      id,
      query.what,
      query.ref_id,
      query.include_not_selected ?? false,
      tenant.id,
    );
  }

  @Get('intakes/:id/call-list')
  @ApiOperation({ summary: 'Name, phone, roll and called flag for one list.' })
  @ApiOkResponse({ type: CallListRowDto, isArray: true })
  callList(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CallListQueryDto,
    @CurrentTenant() tenant: { id: string },
  ) {
    return this.publication.callList(id, query.list_id, tenant.id);
  }

  @Patch('call-list/:applicantId')
  @ApiOperation({ summary: 'Mark an applicant called (or not) with a short note.' })
  @ApiOkResponse({ type: SetCalledResponseDto })
  setCalled(
    @Param('applicantId', ParseUUIDPipe) applicantId: string,
    @Body() dto: SetCalledDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.publication.setCalled(applicantId, dto, tenant.id, this.actor(user, request));
  }
}
