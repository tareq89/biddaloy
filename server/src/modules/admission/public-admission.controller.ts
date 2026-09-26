import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ADMISSION_STATUS_RATE_LIMIT, STRICT_RATE_LIMIT } from '../../rate-limit';
import {
  AdmissionApplicantService,
  ApplicantStatusDto,
  PublicIntakeDto,
} from './admission-applicant.service';
import { SubmitApplicantDto, SubmitApplicantResponseDto } from './dto/submit-applicant.dto';
import { CheckApplicantStatusDto } from './dto/check-applicant-status.dto';

const MAX_DOCUMENT_FILE_SIZE = 5 * 1024 * 1024; // 5MB per document, same tier as homework uploads

/**
 * [27.2] The only admission-facing route reachable with no auth header and
 * no `X-Tenant-ID` — the `:slug` in the URL is the sole tenant signal, same
 * no-guards shape as `PublicInvoiceController`. Every query/write inside
 * `AdmissionApplicantService` resolves and scopes by the tenant that slug
 * maps to; nothing here ever trusts a tenant id from the request body.
 *
 * `ThrottlerGuard` still runs (global `APP_GUARD`) but the submit route
 * tightens it further via `@Throttle` — public write endpoints are the
 * cheapest target for abuse in the whole API.
 */
@ApiTags('public-admission')
@Controller('public/admission')
export class PublicAdmissionController {
  constructor(private readonly applicantService: AdmissionApplicantService) {}

  @Get(':slug')
  @ApiOperation({
    summary: 'Open admission intakes (and their required document types) for a school, by slug.',
  })
  @ApiOkResponse()
  async listOpenIntakes(@Param('slug') slug: string): Promise<PublicIntakeDto[]> {
    return this.applicantService.listOpenIntakes(slug);
  }

  @Post(':slug/status')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: ADMISSION_STATUS_RATE_LIMIT })
  @ApiOperation({
    summary:
      'Check an admission application status by reference number plus the guardian phone given on ' +
      'the form, no login required. Returns only status/applicant name/intake title — an unknown ' +
      'reference, a wrong phone, or a wrong-tenant reference number all 404 identically. POST (not ' +
      'GET) so the phone number never lands in a URL/access log.',
  })
  @ApiOkResponse()
  async getStatus(
    @Param('slug') slug: string,
    @Body() dto: CheckApplicantStatusDto,
  ): Promise<ApplicantStatusDto> {
    return this.applicantService.getStatus(slug, dto);
  }

  @Post(':slug/applicants')
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MAX_DOCUMENT_FILE_SIZE, files: 3 } }))
  @ApiOperation({
    summary:
      'Submit an admission application. Multipart form: applicant fields plus one file field per ' +
      'required document type (photo/birth_certificate/transcript). Resubmitting with the same ' +
      'guardian_phone against the same intake updates the existing PENDING application in place.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        intake_id: { type: 'string', format: 'uuid' },
        applicant_name: { type: 'string' },
        date_of_birth: { type: 'string', format: 'date' },
        gender: { type: 'string' },
        guardian_name: { type: 'string' },
        guardian_phone: { type: 'string' },
        guardian_email: { type: 'string', nullable: true },
        home_address: { type: 'string', nullable: true },
        photo: { type: 'string', format: 'binary' },
        birth_certificate: { type: 'string', format: 'binary' },
        transcript: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOkResponse({ type: SubmitApplicantResponseDto })
  async submit(
    @Param('slug') slug: string,
    @Body() dto: SubmitApplicantDto,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<SubmitApplicantResponseDto> {
    return this.applicantService.submit(slug, dto, files ?? []);
  }
}
