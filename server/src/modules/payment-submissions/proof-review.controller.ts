import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ModuleKey, Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresModule } from '../auth/decorators/require-module.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { QueryProofReviewDto, RejectProofDto, ReopenProofDto } from './dto/proof-review.dto';
import { ProofReviewService } from './proof-review.service';

type Tenant = { id: string };
type User = { sub: string };
const caller = (t: Tenant, u: User) => ({ tenantId: t.id, userId: u.sub });

/** Staff review of guardian payment proofs (D34). */
@ApiTags('payment-submissions')
@ApiTenantAuth()
@Controller('payment-submissions')
@RequiresModule(ModuleKey.fees)
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ProofReviewController {
  constructor(private readonly service: ProofReviewService) {}

  @Get()
  @RequirePermissions(Permission.PAYMENT_RECORD)
  @ApiOperation({ summary: 'List payment proofs (oldest first, cursor paged, limit up to 100).' })
  list(@Query() q: QueryProofReviewDto, @CurrentTenant() t: Tenant, @CurrentUser() u: User) {
    return this.service.list(caller(t, u), q);
  }

  @Get(':id')
  @RequirePermissions(Permission.PAYMENT_RECORD)
  @ApiOperation({ summary: 'One proof with bills, files, history and duplicate flags.' })
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: User,
  ) {
    return this.service.detail(id, caller(t, u));
  }

  @Get(':id/files/:fileId')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions(Permission.PAYMENT_RECORD)
  @ApiOperation({ summary: 'Stream one proof file.' })
  async file(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: User,
  ) {
    const f = await this.service.file(id, fileId, caller(t, u));
    return new StreamableFile(f.body, {
      type: f.contentType,
      ...(f.contentType === 'application/pdf' ? { disposition: 'attachment' } : {}),
    });
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyInterceptor)
  @RequirePermissions(Permission.PAYMENT_RECORD)
  @ApiOperation({
    summary: 'Confirm a proof: records the payment, or discards it if the bill moved.',
  })
  @ApiOkResponse({ description: 'outcome SETTLED or DISCARDED, plus the proof detail.' })
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: User,
  ) {
    return this.service.confirm(id, caller(t, u));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyInterceptor)
  @RequirePermissions(Permission.PAYMENT_RECORD)
  @ApiOperation({ summary: 'Reject a waiting proof with a reason (OTHER needs a note).' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectProofDto,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: User,
  ) {
    return this.service.reject(id, dto, caller(t, u));
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyInterceptor)
  @RequirePermissions(Permission.PAYMENT_RECORD)
  @ApiOperation({ summary: 'Reopen a rejected proof (back to waiting).' })
  reopen(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReopenProofDto,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: User,
  ) {
    return this.service.reopen(id, dto, caller(t, u));
  }
}
