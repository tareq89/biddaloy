import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiProperty, ApiTags, ApiExtraModels, getSchemaPath } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { ADMISSION_STATUS_RATE_LIMIT, STRICT_RATE_LIMIT } from '../../../rate-limit';
import { FailClosedWithoutRedis } from '../../../common/rate-limit/app-throttler.guard';
import { requestContext } from '../../../common/request-context.util';
import { TurnstileService } from '../../registration/turnstile.service';
import { TenantStatusService, tenantRestoringException } from '../../schools/tenant-status.service';
import { MAX_DOCUMENT_FILE_SIZE } from '../../admission/admission-upload.constants';
import { PublicSiteSubmitApplicantDto } from './public-site-submit-applicant.dto';
import { CheckApplicantStatusDto } from '../../admission/dto/check-applicant-status.dto';
import { PublicAdmissionSiteService } from './public-admission-site.service';

export class RollPhoneBodyDto {
  @ApiProperty({ maxLength: 30 })
  @IsString()
  @Length(1, 30)
  roll_number: string;

  @ApiProperty({ minLength: 6, maxLength: 20 })
  @IsString()
  @Length(6, 20)
  guardian_phone: string;
}

/** The text the site shows when a write is refused for want of Redis (D30). */
export const ADMISSION_WRITE_UNAVAILABLE = 'এখন জমা নেওয়া যাচ্ছে না, একটু পরে চেষ্টা করুন';

/**
 * [#4187] Admission for the school site: anonymous, no `X-Tenant-ID`; the host in the URL is the
 * only tenant signal. Every response is `no-store` (a phone number is the key to a name).
 * Writes and result lookups are fail-closed without Redis (Rule 15): no rate limit, no answer.
 */
// core: not tagged with @RequiresModule - public host route; PublicAdmissionSiteService.school answers the site 404 when admission is off.
@ApiTags('public-site')
@ApiExtraModels(PublicSiteSubmitApplicantDto)
@Controller('public/site/by-host/:host/admission')
export class PublicAdmissionSiteController {
  constructor(
    private readonly admission: PublicAdmissionSiteService,
    private readonly turnstile: TurnstileService,
    private readonly tenantStatus: TenantStatusService,
  ) {}

  private noStore(res: Response) {
    res.setHeader('Cache-Control', 'no-store');
  }

  @Get('rounds')
  @ApiOperation({ summary: 'Open rounds with form schema, fee settings, pay methods, documents.' })
  @ApiOkResponse()
  @Throttle({ default: ADMISSION_STATUS_RATE_LIMIT })
  async rounds(@Param('host') host: string, @Res({ passthrough: true }) res: Response) {
    this.noStore(res);
    return this.admission.rounds(host);
  }

  @Get('lists')
  @ApiOperation({ summary: 'Published lists: roll numbers; names only if the round allows.' })
  @ApiOkResponse()
  @Throttle({ default: ADMISSION_STATUS_RATE_LIMIT })
  async lists(@Param('host') host: string, @Res({ passthrough: true }) res: Response) {
    this.noStore(res);
    return this.admission.lists(host);
  }

  @Post('applicants')
  @Throttle({ default: STRICT_RATE_LIMIT })
  @FailClosedWithoutRedis(ADMISSION_WRITE_UNAVAILABLE)
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MAX_DOCUMENT_FILE_SIZE, files: 7 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      allOf: [
        { $ref: getSchemaPath(PublicSiteSubmitApplicantDto) },
        {
          type: 'object',
          properties: {
            fee_proof: { type: 'string', format: 'binary' },
            photo: { type: 'string', format: 'binary' },
            birth_certificate: { type: 'string', format: 'binary' },
            transcript: { type: 'string', format: 'binary' },
            ssc_marksheet: { type: 'string', format: 'binary' },
            transfer_certificate: { type: 'string', format: 'binary' },
            quota_certificate: { type: 'string', format: 'binary' },
          },
        },
      ],
    },
  })
  @ApiOperation({
    summary:
      'Submit an application (multipart). Turnstile first; 409 while the school is being restored.',
  })
  async submit(
    @Param('host') host: string,
    @Body() dto: PublicSiteSubmitApplicantDto,
    @UploadedFiles() files: Express.Multer.File[],
    @Headers('idempotency-key') _idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.noStore(res);
    // First, so a failed check writes no row and no file.
    await this.turnstile.verify(dto.captcha_token, requestContext(request).ip);
    const { tenantId } = await this.admission.school(host);
    if (await this.tenantStatus.isRestoring(tenantId)) throw tenantRestoringException();
    // ponytail: Idempotency-Key is accepted but not stored; the round's duplicate guard (one
    // applicant per child) already makes a retried submit a 409 or an in-place update.
    return this.admission.submit(host, dto, files ?? []);
  }

  @Post('status')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: ADMISSION_STATUS_RATE_LIMIT })
  @ApiOperation({ summary: 'Status by reference number + phone. Every miss is the same 404.' })
  async status(
    @Param('host') host: string,
    @Body() dto: CheckApplicantStatusDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.noStore(res);
    return this.admission.status(host, dto);
  }

  @Post('result')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: ADMISSION_STATUS_RATE_LIMIT })
  @FailClosedWithoutRedis(ADMISSION_WRITE_UNAVAILABLE)
  @ApiOperation({ summary: 'Published stage results and list placement by roll + phone.' })
  async result(
    @Param('host') host: string,
    @Body() dto: RollPhoneBodyDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.noStore(res);
    return this.admission.result(host, dto);
  }

  @Post('admit-card')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: ADMISSION_STATUS_RATE_LIMIT })
  @FailClosedWithoutRedis(ADMISSION_WRITE_UNAVAILABLE)
  @ApiOperation({ summary: 'Admit card data by roll + phone.' })
  async admitCard(
    @Param('host') host: string,
    @Body() dto: RollPhoneBodyDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.noStore(res);
    return this.admission.admitCard(host, dto);
  }
}
