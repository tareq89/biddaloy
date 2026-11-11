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

export interface MfaRowLike {
  user_id: string;
  secret_enc: string;
}

/**
 * Re-encrypts every `user_mfa.secret_enc` under the current key (Epic 98).
 * Same contract as `migrateSchools`: a row already on the current key is left
 * alone; one no configured key can decrypt is counted in `skipped` (the value
 * is never logged) so the script still exits non-zero.
 */
export async function migrateMfa(
  rows: MfaRowLike[],
  encryption: EncryptionService,
  save: (row: MfaRowLike) => Promise<void>,
): Promise<{ migrated: number; skipped: number }> {
  let migrated = 0;
  let skipped = 0;
  for (const row of rows) {
    if (encryption.isCurrent(row.secret_enc)) continue;
    let plaintext: string;
    try {
      plaintext = encryption.decrypt(row.secret_enc);
    } catch {
      skipped += 1;
      console.warn(`Skipping user_mfa:${row.user_id} — could not decrypt with any configured key.`);
      continue;
    }
    row.secret_enc = encryption.encrypt(plaintext);
    await save(row);
    migrated += 1;
  }
  return { migrated, skipped };
}
