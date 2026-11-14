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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ModuleKey, Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresModule } from '../auth/decorators/require-module.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import {
  CreateProofSubmissionDto,
  ProofSubmissionResponseDto,
  QueryProofSubmissionsDto,
} from './dto/proof-submission.dto';
import {
  PROOF_MAX_FILES,
  PROOF_MAX_FILE_SIZE,
  ProofSubmissionsService,
} from './proof-submissions.service';

type Tenant = { id: string; role: string };
type User = { sub: string };
const caller = (t: Tenant, u: User) => ({ tenantId: t.id, role: t.role, userId: u.sub });

/** Guardian portal: payment proofs for a linked child's open bills. PARENT only (D34). */
@ApiTags('portal')
@ApiTenantAuth()
@Controller('portal/payment-proofs')
@RequiresModule(ModuleKey.fees)
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ProofSubmissionsController {
  constructor(private readonly service: ProofSubmissionsService) {}

  @Post()
  @UseInterceptors(
    IdempotencyInterceptor,
    FilesInterceptor('files', PROOF_MAX_FILES, { limits: { fileSize: PROOF_MAX_FILE_SIZE } }),
  )
  @RequirePermissions(Permission.PAYMENT_SUBMIT)
  @ApiOperation({ summary: 'Submit a payment proof (TrxID and/or up to 2 JPG/PNG/PDF files).' })
  @ApiConsumes('multipart/form-data')
  @ApiCreatedResponse({ type: ProofSubmissionResponseDto })
  submit(
    @Body() dto: CreateProofSubmissionDto,
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: User,
  ) {
    return this.service.submit(dto, files, caller(t, u));
  }

  @Get()
  @RequirePermissions(Permission.PAYMENT_SUBMIT)
  @ApiOperation({ summary: "Payment proofs for the caller's linked children." })
  @ApiOkResponse({ type: ProofSubmissionResponseDto, isArray: true })
  list(@Query() q: QueryProofSubmissionsDto, @CurrentTenant() t: Tenant, @CurrentUser() u: User) {
    return this.service.list(caller(t, u), q.studentId, q.limit);
  }

  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PAYMENT_SUBMIT)
  @ApiOperation({ summary: 'Withdraw a waiting proof (submitter only).' })
  @ApiOkResponse({ type: ProofSubmissionResponseDto })
  withdraw(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: User,
  ) {
    return this.service.withdraw(id, caller(t, u));
  }

  @Get(':id/files/:fileId')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions(Permission.PAYMENT_SUBMIT)
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
}
