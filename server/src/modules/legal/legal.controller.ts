import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { LEGAL_DOCS, GUARDIAN_ROLES, JwtPayload, STAFF_ROLES } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AllowWhenReadOnly } from '../auth/decorators/allow-when-read-only.decorator';
import { AuthenticatedOnly } from '../auth/decorators/authenticated-only.decorator';
import { DenyWhenImpersonating } from '../auth/decorators/deny-when-impersonating.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { LegalService } from './legal.service';
import { AcceptLegalDto, LegalStatusResponseDto } from './dto/legal.dto';

const ALL_ROLES = [...STAFF_ROLES, ...GUARDIAN_ROLES];

/** The caller's own legal acceptance state. Identity-scoped: ids come from the JWT. */
@ApiTags('legal')
@ApiTenantAuth()
@Controller('legal')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  @AuthenticatedOnly()
  @Get('status')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Legal documents the caller still owes in this school.' })
  @ApiOkResponse({ type: LegalStatusResponseDto })
  async status(
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() jwt: JwtPayload,
  ): Promise<LegalStatusResponseDto> {
    return { pending: await this.legal.pending(jwt.sub, tenant.id, tenant.role) };
  }

  @AuthenticatedOnly()
  @AllowWhenReadOnly()
  @DenyWhenImpersonating()
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Accept the current version of the named legal documents.' })
  @ApiOkResponse({ type: LegalStatusResponseDto })
  async accept(
    @Body() dto: AcceptLegalDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() jwt: JwtPayload,
    @Req() request: Request,
  ): Promise<LegalStatusResponseDto> {
    // The text the user read came from their client build: refuse a stale version (fixed sentence).
    if (dto.documents.some((d) => dto.versions[d] !== LEGAL_DOCS[d].version)) {
      throw new ConflictException('Legal document version changed, reload and read it again');
    }
    await this.legal.accept(jwt.sub, tenant.id, dto.documents, request.ip ?? null);
    return { pending: await this.legal.pending(jwt.sub, tenant.id, tenant.role) };
  }
}
