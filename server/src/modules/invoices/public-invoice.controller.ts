import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InvoiceShareService } from './invoice-share.service';
import { StorageService } from '../storage/storage.service';
import { School } from '../schools/entities/school.entity';
import { resolveIssuer } from '../schools/profile/issuer-snapshot';
import { readLogoDataUrl } from '../schools/profile/logo-data-url';
import { buildPublicReceiptDto, PublicReceiptDto } from './public-invoice-receipt.dto';
import { PUBLIC_INVOICE_RATE_LIMIT } from '../../rate-limit';

/**
 * [#666] The one invoice-facing route reachable with no auth header and no
 * `X-Tenant-ID` — tenant scope comes entirely from the share token row
 * (`InvoiceShareService.validatePublicToken`), the same no-guards shape
 * `AccountAccessController`'s `/auth/activate*` routes already use: there
 * is no principal to authenticate yet, so `AuthGuard`/`ContextGuard`/
 * `RolesGuard`/`PermissionsGuard` simply don't apply here. `ThrottlerGuard`
 * still runs (it's a global `APP_GUARD` — see app.module.ts) and falls
 * back to per-IP bucketing for a request with no bearer token.
 */
@ApiTags('public-invoices')
@Controller('public/invoices')
export class PublicInvoiceController {
  constructor(
    private readonly shareService: InvoiceShareService,
    private readonly storage: StorageService,
    @InjectRepository(School)
    private readonly schoolRepo: Repository<School>,
  ) {}

  // [#666 scope note] The issue body's step 3 also asked for a
  // `?format=a4|pos80` HTML variant reusing #665's print templates. Not
  // implemented in this pass — those templates render the FULL internal
  // invoice (registration numbers, unredacted payment reference, etc.),
  // so wiring them into this unauthenticated route would need either a
  // second, redacted-HTML template or threading redaction through the
  // existing ones, which is more than an additive change here. Left as a
  // JSON-only receipt for now; flagged to the parent as an explicit scope
  // decision rather than a silent drop — see the PR description / #666.
  @Get(':token')
  @Throttle({ default: PUBLIC_INVOICE_RATE_LIMIT })
  @ApiOperation({
    summary:
      'Public, receipt-only view of an invoice via a share token. No auth, no tenant header — 404 for an unknown or revoked token. HTML (?format=a4|pos80) variant not yet implemented — see code comment.',
  })
  async getByToken(@Param('token') token: string): Promise<PublicReceiptDto> {
    const result = await this.shareService.validatePublicToken(token);
    if (!result) {
      throw new NotFoundException('Share link not found or no longer active');
    }
    const { invoice, tenantId } = result;

    // [15.5.5] Same live-profile fallback the authenticated print/read
    // paths use for invoices predating `issuer_snapshot`. `findOne` (not
    // `findOneOrFail`) — a school that's since been soft-deleted (or, in
    // theory, hard-removed) must 404 like any other dead token on this
    // unauthenticated route, not throw an unhandled 500.
    const school = await this.schoolRepo.findOne({ where: { id: tenantId } });
    if (!school) {
      throw new NotFoundException('Share link not found or no longer active');
    }
    const issuer = resolveIssuer(invoice, school);
    const logoUrl = await readLogoDataUrl(this.storage, issuer.logo_key);

    return buildPublicReceiptDto(invoice, issuer, logoUrl);
  }
}
