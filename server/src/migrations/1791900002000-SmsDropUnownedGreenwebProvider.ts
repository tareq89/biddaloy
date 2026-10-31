import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [#3339] The old SMS form stored `communications.sms.provider = 'greenweb'` for schools on the
 * platform account. That stored name beats the platform's `SMS_PROVIDER`, so once production
 * picks another company those schools would stop sending.
 *
 * Removes `provider` and the `greenweb` block from `communications.sms` only when:
 *   - `metering` is `PLATFORM`, and `provider` is `greenweb`, and
 *   - no other key under `communications.sms` holds a non-empty value (an encrypted `apiKey`, an
 *     `apiUrl`, a draft for another company, or the old flat layout all count as the school's own).
 * `metering` and every other setting stay. Idempotent: a cleaned row no longer matches.
 *
 *   before: { metering: 'PLATFORM', provider: 'greenweb', greenweb: {} }
 *   after:  { metering: 'PLATFORM' }
 */
export class SmsDropUnownedGreenwebProvider1791900002000 implements MigrationInterface {
  name = 'SmsDropUnownedGreenwebProvider1791900002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "schools" s
      SET "settings" = jsonb_set(
        s."settings",
        '{communications,sms}',
        (s."settings" #> '{communications,sms}') - 'provider' - 'greenweb'
      )
      WHERE s."settings" #>> '{communications,sms,metering}' = 'PLATFORM'
        AND s."settings" #>> '{communications,sms,provider}' = 'greenweb'
        AND jsonb_typeof(s."settings" #> '{communications,sms}') = 'object'
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_each(
            CASE WHEN jsonb_typeof(s."settings" #> '{communications,sms}') = 'object'
                 THEN s."settings" #> '{communications,sms}' ELSE '{}'::jsonb END
          ) AS e(key, value)
          WHERE e.key NOT IN ('provider', 'metering')
            AND jsonb_path_exists(
              e.value,
              '$.** ? (@.type() == "number" || @.type() == "boolean" || (@.type() == "string" && @ != ""))'
            )
        )
    `);
  }

  /** Nothing to restore: the removed name and block held no value of the school's own. */
  public async down(_queryRunner: QueryRunner): Promise<void> {}
}
