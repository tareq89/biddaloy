import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { TtlCache } from './ttl-cache';
import { normalizeHost } from '../../../common/utils/normalize-host.util';
import { SiteCustomDomainStatus } from '@biddaloy/shared';
import { SchoolSite } from '../entities/school-site.entity';

// Kept exported here so existing imports keep working.
export { normalizeHost };

/** A redirect carries its site too, so the caller can check the site is live before answering 301. */
export type ResolvedHost =
  { tenantId: string; site: SchoolSite } | { redirectTo: string; site: SchoolSite } | null;

/**
 * [40.1.04] Host name -> school site (D34). Subdomain of `SITE_ROOT_DOMAIN`, else an ACTIVE
 * custom domain, else a renamed subdomain still inside its 30-day redirect window.
 * Never says why a host did not resolve: the caller answers one 404 for all of them (Rule 23).
 */
@Injectable()
export class SiteHostService {
  constructor(@InjectRepository(SchoolSite) private readonly sites: Repository<SchoolSite>) {}

  private rootDomain(): string | null {
    const root = process.env.SITE_ROOT_DOMAIN?.trim().toLowerCase();
    return root ? root : null;
  }

  // 5 s: a switch-off, suspend or rename shows up at most this late. Caches the row lookups,
  // not the answer, so the redirect window is still judged against `now` on every call.
  private readonly cache = new TtlCache<SchoolSite | null>();

  clearCache(): void {
    this.cache.clear();
  }

  private find(key: string, where: FindOptionsWhere<SchoolSite>) {
    return this.cache.get(key, () => this.sites.findOne({ where }));
  }

  async resolve(rawHost: string, now: Date = new Date()): Promise<ResolvedHost> {
    const host = normalizeHost(rawHost);
    if (!host) return null;
    const root = this.rootDomain();

    if (root && host.endsWith(`.${root}`)) {
      const label = host.slice(0, -(root.length + 1));
      if (label.includes('.')) return null;
      const site = await this.find(`sub:${label}`, { subdomain: label });
      if (site) return { tenantId: site.tenant_id, site };
      const old = await this.find(`prev:${label}`, { previous_subdomain: label });
      if (old?.previous_until && old.previous_until > now) {
        return { redirectTo: `${old.subdomain}.${root}`, site: old };
      }
      return null;
    }

    const site = await this.find(`dom:${host}`, {
      custom_domain: host,
      custom_domain_status: SiteCustomDomainStatus.ACTIVE,
    });
    return site ? { tenantId: site.tenant_id, site } : null;
  }
}
