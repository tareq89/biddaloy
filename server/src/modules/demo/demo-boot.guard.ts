import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { DEMO_SCHOOL_SLUGS } from './demo-accounts';

/**
 * D30: a demo build must never run against a real database. On boot with `DEMO_MODE=true`,
 * any live school whose slug is not a demo branch (the explicitly configured platform tenant
 * excepted) stops the process.
 */
@Injectable()
export class DemoBootGuard implements OnApplicationBootstrap {
  private readonly logger = new Logger(DemoBootGuard.name);

  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get<string>('DEMO_MODE') !== 'true') return;

    const platformId = this.config.get<string>('PLATFORM_TENANT_ID');
    const rows: { id: string; slug: string }[] = await this.dataSource.query(
      'SELECT id, slug FROM schools WHERE deleted_at IS NULL',
    );
    const allowed = new Set<string>(DEMO_SCHOOL_SLUGS);
    const foreign = rows.filter((r) => !allowed.has(r.slug) && r.id !== platformId);
    if (foreign.length > 0) {
      this.logger.error(
        `DEMO_MODE refuses to start: database holds non-demo schools (${foreign.map((r) => r.slug).join(', ')})`,
      );
      process.exit(1);
    }
  }
}
