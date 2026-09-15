import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { randomBytes, createHash } from 'node:crypto';
import { AuditAction } from '@biddaloy/shared';
import { InvoiceShareToken } from './entities/invoice-share-token.entity';
import { Invoice } from './entities/invoice.entity';
import { AuditService } from '../audit/audit.service';

/** [#666] The raw, caller-facing token (`InvoiceShareToken.token_hash`'s
 * pre-image) is 32 random bytes, base64url-encoded — never persisted. */
function generateRawToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export interface CreateShareTokenResult {
  rawToken: string;
  tokenId: string;
}

@Injectable()
export class InvoiceShareService {
  constructor(
    @InjectRepository(InvoiceShareToken)
    private readonly repo: Repository<InvoiceShareToken>,
    @InjectRepository(Invoice)
    private readonly invoiceRepo: Repository<Invoice>,
    private readonly audit: AuditService,
  ) {}

  /**
   * Mints a fresh share token for `invoiceId`.
   *
   * The ticket describes this as "reuse an existing unrevoked token if one
   * exists" — but `token_hash` is a one-way SHA-256 digest, and the raw
   * token is never stored anywhere, by design (see the entity doc). Once
   * the original `POST` response has been consumed, there is no value
   * left in the database that could reconstruct that raw token to return
   * it again. "Reuse" is therefore read as "don't force a revoke of prior
   * links just because a new one is requested" rather than "return the
   * same URL twice": any number of unrevoked tokens can be live for one
   * invoice at once, and this always mints a new one. Flagged in the PR
   * for a product call if literal single-active-link semantics are
   * wanted instead — that would require either accepting the token is
   * only ever shown once, or a materially different (reversible) storage
   * scheme deliberately rejected by the ticket's "raw token never stored"
   * requirement.
   */
  async createToken(
    invoiceId: string,
    tenantId: string,
    actorUserId: string,
  ): Promise<CreateShareTokenResult> {
    const invoice = await this.invoiceRepo.findOne({
      where: { id: invoiceId, deleted_at: IsNull() },
      relations: ['student'],
    });
    if (!invoice || invoice.student.tenant_id !== tenantId) {
      throw new NotFoundException(`Invoice with ID "${invoiceId}" not found`);
    }

    const rawToken = generateRawToken();
    const saved = await this.repo.save(
      this.repo.create({
        tenant_id: tenantId,
        invoice_id: invoiceId,
        token_hash: hashToken(rawToken),
        created_by_user_id: actorUserId,
      }),
    );

    await this.audit.record({
      action: AuditAction.CREATE,
      entity_type: 'Invoice',
      entity_id: invoiceId,
      tenant_id: tenantId,
      performed_by_user_id: actorUserId,
      new_values: { share_token_id: saved.id },
    });

    return { rawToken, tokenId: saved.id };
  }

  async revokeToken(tokenId: string, tenantId: string, actorUserId: string): Promise<void> {
    const token = await this.repo.findOne({ where: { id: tokenId, tenant_id: tenantId } });
    if (!token) {
      throw new NotFoundException(`Share token "${tokenId}" not found`);
    }
    token.revoked_at = new Date();
    await this.repo.save(token);

    await this.audit.record({
      action: AuditAction.DELETE,
      entity_type: 'Invoice',
      entity_id: token.invoice_id,
      tenant_id: tenantId,
      performed_by_user_id: actorUserId,
      old_values: { share_token_id: token.id },
    });
  }

  async listTokens(
    invoiceId: string,
    tenantId: string,
  ): Promise<Omit<InvoiceShareToken, 'token_hash' | 'invoice' | 'created_by'>[]> {
    const tokens = await this.repo.find({
      where: { invoice_id: invoiceId, tenant_id: tenantId },
      order: { created_at: 'DESC' },
    });
    return tokens.map(
      ({ token_hash: _tokenHash, invoice: _invoice, created_by: _createdBy, ...rest }) => rest,
    );
  }

  /**
   * Validates a raw token from `GET /public/invoices/:token` and, on
   * success, bumps `view_count`/`last_viewed_at`. Returns `null` for any
   * unknown, revoked token — the public controller turns that uniformly
   * into a 404, never distinguishing "doesn't exist" from "revoked" (that
   * distinction would itself leak information to an outside caller).
   */
  async validatePublicToken(
    rawToken: string,
  ): Promise<{ invoice: Invoice; tenantId: string } | null> {
    const token = await this.repo.findOne({
      where: { token_hash: hashToken(rawToken) },
      relations: ['invoice'],
    });
    // `token.invoice` can come back null even for a row that still exists:
    // `Invoice` carries a `@DeleteDateColumn`, so TypeORM's relation join
    // silently excludes a soft-deleted invoice. Treat that the same as
    // "not found" — both to 404 correctly and to avoid the `save()` below
    // writing a null FK back onto the token row.
    if (!token || token.revoked_at || !token.invoice) {
      return null;
    }

    // `update()` instead of a read-modify-write `save()`: avoids clobbering
    // the (already-loaded, unrelated) `invoice` relation back onto the row,
    // and avoids losing a concurrent view under read-modify-write races.
    await this.repo.update(token.id, {
      view_count: () => '"view_count" + 1',
      last_viewed_at: new Date(),
    });

    return { invoice: token.invoice, tenantId: token.tenant_id };
  }
}
