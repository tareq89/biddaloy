import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  ADMIN_REQUIRED_DOCS,
  AuditAction,
  LEGAL_DOCS,
  LegalDocument,
  UserRole,
} from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import { LegalAcceptance } from './entities/legal-acceptance.entity';

/** [59.2.01] Which legal documents a school admin still owes, and recording their acceptance. */
@Injectable()
export class LegalService {
  constructor(
    @InjectRepository(LegalAcceptance) private readonly repo: Repository<LegalAcceptance>,
    private readonly audit: AuditService,
  ) {}

  /** Only an ADMIN owes documents (D7). Owed = no row at the document's current version (D15). */
  async pending(userId: string, tenantId: string, role: string): Promise<LegalDocument[]> {
    if (role !== UserRole.ADMIN) return [];
    const rows = await this.repo.find({
      where: { user_id: userId, tenant_id: tenantId },
      select: { document: true, version: true },
    });
    const accepted = new Set(rows.map((r) => `${r.document}@${r.version}`));
    return ADMIN_REQUIRED_DOCS.filter((doc) => !accepted.has(`${doc}@${LEGAL_DOCS[doc].version}`));
  }

  /**
   * Records the current version of each document; a repeat is a no-op. Pass `manager` to join
   * an open transaction (registration).
   */
  async accept(
    userId: string,
    tenantId: string,
    docs: readonly LegalDocument[],
    ip: string | null,
    manager?: EntityManager,
  ): Promise<void> {
    // Fixed sentence, the submitted value is never echoed (Rule 23).
    if (docs.some((d) => !Object.hasOwn(LEGAL_DOCS, d))) {
      throw new BadRequestException('Unknown legal document');
    }
    const unique = [...new Set(docs)];
    if (unique.length === 0) return;
    const versions = Object.fromEntries(unique.map((d) => [d, LEGAL_DOCS[d].version]));
    await (manager ? manager.getRepository(LegalAcceptance) : this.repo)
      .createQueryBuilder()
      .insert()
      .values(
        unique.map((document) => ({
          user_id: userId,
          tenant_id: tenantId,
          document,
          version: versions[document],
          ip,
        })),
      )
      .orIgnore()
      .execute();
    await this.audit.record(
      {
        action: AuditAction.CREATE,
        entity_type: 'User', // ponytail: no LegalAcceptance in shared AuditEntityType (outside lane); add it there later
        entity_id: userId,
        tenant_id: tenantId,
        performed_by_user_id: userId,
        ip_address: ip,
        new_values: { legal_accepted: versions },
      },
      manager,
    );
  }
}
