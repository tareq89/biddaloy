import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { hashSecret } from '../../auth/token-hash.util';

/**
 * D22 — the ONLY fields the public verify page may ever show. The service
 * builds the response from this list, and the spec asserts the key set, so a new
 * column can never leak by accident (no ids, photo, class or phone).
 */
export const PUBLIC_VERIFY_FIELDS = [
  'document_kind',
  'holder_name',
  'school_name',
  'school_name_bn',
  'issued_at',
  'copy_number',
  'status',
] as const;

export interface PublicVerifyResult {
  document_kind: string;
  holder_name: string;
  school_name: string;
  school_name_bn: string | null;
  issued_at: string;
  copy_number: number;
  status: 'VALID' | 'REVOKED';
  revoked_at?: string;
}

@Injectable()
export class PublicVerifyService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async verify(token: string): Promise<PublicVerifyResult> {
    // Hash first, always: an unknown token costs the same as a known one.
    const hash = hashSecret(token);
    // Tokens are globally unique, so this looks across tenants on purpose.
    const rows = await this.ds.query(
      `SELECT i.document_kind, i.subject_label, i.copy_number, i.revoked_at,
              coalesce(i.data_snapshot->>'issuedAt', i.created_at::text) AS issued_at,
              s.name AS school_name, s.name_bn AS school_name_bn
         FROM print_job_items i
         JOIN schools s ON s.id = i.tenant_id
        WHERE i.verify_token_hash = $1`,
      [hash],
    );
    if (rows.length === 0) throw new NotFoundException('We could not find this document');
    const r = rows[0];
    const result: PublicVerifyResult = {
      document_kind: r.document_kind,
      holder_name: r.subject_label,
      school_name: r.school_name,
      school_name_bn: r.school_name_bn ?? null,
      issued_at: new Date(r.issued_at).toISOString(),
      copy_number: r.copy_number,
      status: r.revoked_at ? 'REVOKED' : 'VALID',
    };
    if (r.revoked_at) result.revoked_at = new Date(r.revoked_at).toISOString();
    return result;
  }
}
