import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [TEN-05] `push_subscriptions.endpoint` was globally unique, so one device
 * could belong to only one school: subscribing in school B silently moved
 * the row away from school A. Make it unique per `(endpoint, tenant_id)`.
 */
export class PushSubscriptionEndpointPerTenant1791805000100 implements MigrationInterface {
  name = 'PushSubscriptionEndpointPerTenant1791805000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "push_subscriptions" DROP CONSTRAINT "UQ_push_subscriptions_endpoint"`,
    );
    await queryRunner.query(
      `ALTER TABLE "push_subscriptions" ADD CONSTRAINT "UQ_push_subscriptions_endpoint_tenant" UNIQUE ("endpoint", "tenant_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-adding the global key would fail half-way if an endpoint is in two schools.
    const dupes = await queryRunner.query(
      `SELECT endpoint FROM "push_subscriptions" GROUP BY endpoint HAVING count(*) > 1`,
    );
    if (dupes.length > 0) {
      throw new Error(
        `Cannot revert PushSubscriptionEndpointPerTenant: ${dupes.length} endpoint(s) exist in more than one tenant. Delete the extra rows first.`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "push_subscriptions" DROP CONSTRAINT "UQ_push_subscriptions_endpoint_tenant"`,
    );
    await queryRunner.query(
      `ALTER TABLE "push_subscriptions" ADD CONSTRAINT "UQ_push_subscriptions_endpoint" UNIQUE ("endpoint")`,
    );
  }
}
