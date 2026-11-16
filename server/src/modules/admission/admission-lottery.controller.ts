import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ModuleKey, Permission, type JwtPayload } from '@biddaloy/shared';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import { RequiresModule } from '../auth/decorators/require-module.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AdmissionLotteryService } from './admission-lottery.service';
import type { ResultActor } from './admission-stage-result.service';
import {
  CommitLotteryImportDto,
  LotteryDrawResponseDto,
  LotteryImportCommitResponseDto,
  LotteryImportValidateResponseDto,
} from './dto/lottery.dto';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

/** [71.G2.06, D15] Lottery draw and list import. */
@ApiTags('admission')
@ApiTenantAuth()
@Controller('admission')
@RequiresModule(ModuleKey.admission)
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.ADMISSION_REVIEW)
export class AdmissionLotteryController {
  constructor(private readonly lottery: AdmissionLotteryService) {}

  private actor(user: JwtPayload, request: Request): ResultActor {
    const ctx = requestContext(request);
    return { userId: user.sub, ip: ctx.ip, userAgent: ctx.userAgent };
  }

  @Post('stages/:id/lottery/draw')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Draw the lottery once. A second draw is 409 LOTTERY_ALREADY_DRAWN. No reset.',
  })
  @ApiOkResponse({ type: LotteryDrawResponseDto })
  draw(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.lottery.draw(id, tenant.id, this.actor(user, request));
  }

  @Post('stages/:id/lottery/import/validate')
  @HttpCode(200)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  @ApiOperation({
    summary: 'Check an xlsx list of ranks (max 5MB) and stage it. Writes nothing.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOkResponse({ type: LotteryImportValidateResponseDto })
  validate(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.lottery.validate(id, file, tenant.id, user.sub);
  }

  @Post('stages/:id/lottery/import/commit')
  @HttpCode(200)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({ summary: 'Commit a validated list. The staging id works once.' })
  @ApiOkResponse({ type: LotteryImportCommitResponseDto })
  commit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommitLotteryImportDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.lottery.commit(id, dto.staging_id, tenant.id, this.actor(user, request));
  }
}
