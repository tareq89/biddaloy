import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { SmsBundleCatalogService } from './catalog/sms-bundle-catalog.service';
import { SmsCreditService } from '../communications/credits/sms-credit.service';

/** [Epic 100 #3855] The app boots with `SmsBundlesModule` and the six SMS money tables exist. */
describe('SmsBundlesModule (boot)', () => {
  let app: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await app.init();
  }, 90_000);

  afterAll(async () => {
    await app.close();
  });

  it('resolves the catalog service from the module and the credit service from CreditsModule', () => {
    expect(app.get(SmsBundleCatalogService, { strict: false })).toBeDefined();
    expect(app.get(SmsCreditService, { strict: false })).toBeDefined();
  });

  it('has the six tables', async () => {
    const rows: { t: string }[] = await app.get(DataSource).query(
      `SELECT table_name AS t FROM information_schema.tables
          WHERE table_name = ANY($1) ORDER BY 1`,
      [
        [
          'sms_bundle_catalog',
          'sms_bundle_orders',
          'sms_credit_lot_draws',
          'sms_credit_lots',
          'sms_provider_balance_readings',
          'sms_stock_entries',
        ],
      ],
    );
    expect(rows).toHaveLength(6);
  });
});
