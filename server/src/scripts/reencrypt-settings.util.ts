import type { School } from '../modules/schools/entities/school.entity';
import type { EncryptionService } from '../modules/schools/settings/encryption.service';
import { reencryptSecretFields } from '../modules/schools/settings/settings-encryption.util';

export const BATCH_SIZE = 200;

export type SchoolLike = Pick<School, 'id' | 'settings'>;

/**
 * The migration itself, decoupled from `NestFactory`/TypeORM (kept out of
 * `reencrypt-settings.ts`, which imports `AppModule`) so it can be
 * unit-tested against a plain array and a spy `save` in
 * `reencrypt-settings.spec.ts` without booting the app. `reencryptSettings`
 * in `reencrypt-settings.ts` is the thin wrapper that wires up a real
 * `DataSource` and calls this per batch.
 *
 * `migrated` only counts a school where `reencryptSecretFields` actually
 * changed something (a legacy plaintext value encrypted, or a previous-key
 * value rotated onto the current one) — a school already fully on the
 * current key is left untouched and not saved, which is what makes
 * `migrated === 0, skipped === 0` a meaningful "nothing left to do" signal
 * on a re-run rather than every school being reported every time.
 */
export async function migrateSchools(
  schools: SchoolLike[],
  encryption: EncryptionService,
  save: (school: SchoolLike) => Promise<void>,
): Promise<{ migrated: number; skipped: number }> {
  let migrated = 0;
  let skipped = 0;

  for (const school of schools) {
    if (!school.settings) continue;

    const before = school.settings as Record<string, unknown>;
    const after = reencryptSecretFields(before, encryption, (error, path) => {
      skipped += 1;
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `Skipping ${school.id}:${path} — could not decrypt with any configured key: ${reason}`,
      );
    });

    if (JSON.stringify(after) !== JSON.stringify(before)) {
      school.settings = after;
      await save(school);
      migrated += 1;
    }
  }

  return { migrated, skipped };
}
