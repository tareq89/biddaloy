import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  RESERVED_SUBDOMAINS,
  SITE_SUBDOMAIN_RE,
  SITE_SUBDOMAIN_REDIRECT_DAYS,
  labelEnvTag,
  siteEnvTag,
  withSiteEnvTag,
} from '@biddaloy/shared';
import type { SiteEnvTag } from '@biddaloy/shared';
import { School } from '../schools/entities/school.entity';
import { SchoolSite } from './entities/school-site.entity';
import { SiteCacheService } from './public/site-cache.service';
import { SiteConfigService } from './site-config.service';
import type { SiteDto } from './dto/site-config.dto';

/** One sentence for every way a rename can fail: malformed, reserved, taken, lost a race (Rule 23). */
export const subdomainUnavailable = () => new BadRequestException('site.subdomain_unavailable');

/**
 * Format, not reserved, and the label's environment tag is exactly this environment's (D5):
 * nginx routes by the suffix, so a wrong or missing one would reach the wrong container.
 * Never fixes the name: the admin screen adds the tag, the server only judges.
 */
export const isValidSubdomain = (v: unknown, tag: SiteEnvTag | ''): v is string =>
  typeof v === 'string' &&
  SITE_SUBDOMAIN_RE.test(v) &&
  !RESERVED_SUBDOMAINS.includes(v) &&
  labelEnvTag(v) === tag;

const slugify = (s: string, max = 30) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');

/**
 * Candidates in D34 order: the name slug, the initials, the slug plus `-school`.
 * ponytail: schools carry no district, so the third is a fixed suffix; swap in a district when it exists.
 */
export function candidatesFor(name: string, tag: SiteEnvTag | ''): string[] {
  const words = name.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  // Room for the tag, like slugFor: a long name shrinks instead of losing its candidate.
  const max = 30 - (tag ? tag.length + 1 : 0);
  const slug = slugify(name, max);
  const initials = words.map((w) => w[0]).join('');
  return [...new Set([slug, initials, slugify(`${slug}-school`, max)])]
    .map((c) => withSiteEnvTag(c, tag))
    .filter((c) => isValidSubdomain(c, tag));
}

/** [40.2.01] Choose and change the site's web address (D34). */
@Injectable()
export class SubdomainService {
  constructor(
    @InjectRepository(SchoolSite) private readonly sites: Repository<SchoolSite>,
    @InjectRepository(School) private readonly schools: Repository<School>,
    private readonly config: SiteConfigService,
    private readonly cache: SiteCacheService,
  ) {}

  private get tag() {
    return siteEnvTag(process.env.ENV_NAME);
  }

  /** Free = no other school has it now and no other school's 30-day redirect still holds it. */
  private async isFree(value: string, tenantId: string, now: Date): Promise<boolean> {
    const taken = await this.sites
      .createQueryBuilder('s')
      .where('s.tenant_id <> :tenantId', { tenantId })
      .andWhere(
        '(s.subdomain = :value OR (s.previous_subdomain = :value AND s.previous_until > :now))',
        { value, now },
      )
      .getExists();
    return !taken;
  }

  /** `{ available: false }` for malformed, reserved and taken alike: no reason leaks. */
  async check(tenantId: string, value: unknown, now = new Date()): Promise<{ available: boolean }> {
    return {
      available: isValidSubdomain(value, this.tag) && (await this.isFree(value, tenantId, now)),
    };
  }

  async suggest(tenantId: string): Promise<{ suggestions: string[] }> {
    const school = await this.schools.findOneOrFail({ where: { id: tenantId } });
    const suggestions: string[] = [];
    for (const c of candidatesFor(school.name, this.tag)) {
      if ((await this.check(tenantId, c)).available) suggestions.push(c);
    }
    return { suggestions };
  }

  /** The old name keeps answering a 301 for 30 days (`previous_*`), then is freed. */
  async rename(tenantId: string, value: string, now = new Date()): Promise<SiteDto> {
    const dto = await this.config.get(tenantId); // first call creates the row
    if (value === dto.subdomain) return dto;
    if (!(await this.check(tenantId, value, now)).available) throw subdomainUnavailable();
    try {
      await this.sites.manager.transaction(async (m) => {
        // Another school's expired redirect may still hold the name we are leaving (unique index): free it.
        await m
          .createQueryBuilder()
          .update(SchoolSite)
          .set({ previous_subdomain: null, previous_until: null })
          .where(
            'previous_subdomain = :value AND previous_until <= :now AND tenant_id <> :tenantId',
            {
              value: dto.subdomain,
              now,
              tenantId,
            },
          )
          .execute();
        await m.update(
          SchoolSite,
          { tenant_id: tenantId },
          {
            subdomain: value,
            previous_subdomain: dto.subdomain,
            previous_until: new Date(now.getTime() + SITE_SUBDOMAIN_REDIRECT_DAYS * 86_400_000),
          },
        );
      });
    } catch (e) {
      // A concurrent rename won the unique index: same answer as "taken".
      if ((e as { driverError?: { code?: string } }).driverError?.code === '23505') {
        throw subdomainUnavailable();
      }
      throw e;
    }
    await this.cache.invalidate(tenantId);
    return this.config.get(tenantId);
  }
}
