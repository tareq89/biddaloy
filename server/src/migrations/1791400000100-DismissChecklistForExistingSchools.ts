import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * #1706 F4 — schools that existed before Epic 13 must not get the new
 * "Finish setting up your school" dashboard card.
 *
 * `OnboardingFoundation1791400000000` marks every existing school
 * `{ "finished_at": <now> }` and nothing else (D36). The checklist card hides
 * only on `dismissed_at`, so this stamps `dismissed_at` on exactly those rows.
 *
 * Which rows: `onboarding` holds the single key `finished_at`. That is the
 * backfill's shape and nothing else's — the app writes `finished_at` only from
 * the welcome wizard, which also writes `seen_by` (on mount) and usually
 * `setup_path`, and a brand-new school starts with no `finished_at` at all.
 * Both migrations ship in the same release, so in practice no new school
 * exists yet when this runs; the shape check keeps it safe even if one does.
 *
 * `dismissed_at` copies `finished_at`, so `down()` can tell its own stamp
 * apart from a dismissal a person made later.
 */
export class DismissChecklistForExistingSchools1791400000100 implements MigrationInterface {
  name = 'DismissChecklistForExistingSchools1791400000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "schools"
          SET "onboarding" = "onboarding" || jsonb_build_object('dismissed_at', "onboarding"->'finished_at')
        WHERE "onboarding" ? 'finished_at'
          AND "onboarding" - 'finished_at' = '{}'::jsonb
          AND "onboarding"->'finished_at' <> 'null'::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only rows still exactly as `up()` left them.
    await queryRunner.query(
      `UPDATE "schools"
          SET "onboarding" = "onboarding" - 'dismissed_at'
        WHERE "onboarding" - 'finished_at' - 'dismissed_at' = '{}'::jsonb
          AND "onboarding"->'dismissed_at' = "onboarding"->'finished_at'`,
    );
  }
}
