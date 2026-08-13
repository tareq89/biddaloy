import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { School } from '../modules/schools/entities/school.entity';
import { EncryptionService } from '../modules/schools/settings/encryption.service';
import { reencryptSecretFields } from '../modules/schools/settings/settings-encryption.util';

/**
 * Brings every school's stored tenant-settings secrets onto the current
 * `SETTINGS_ENCRYPTION_KEY` — see `EncryptionService`'s "Key rotation"
 * class comment for the full procedure this is step 3 of. In one pass it:
 *
 * - Encrypts legacy plaintext secrets (rows written before this feature
 *   existed) for the first time.
 * - Re-encrypts secrets still under a previous key, once rotated out via
 *   `SETTINGS_ENCRYPTION_KEY_PREVIOUS`.
 *
 * Safe to re-run: each school is loaded, migrated, and saved independently,
 * so an interruption only costs re-processing schools already done (a
 * harmless no-op re-encryption with a fresh IV), not partial/corrupt state.
 *
 * Exits non-zero if any secret can't be decrypted under a configured key —
 * that's the actual signal `SETTINGS_ENCRYPTION_KEY_PREVIOUS` is safe to
 * drop, rather than operator judgement.
 */
export async function reencryptSettings(): Promise<{ migrated: number; skipped: number }> {
  const app = await NestFactory.createApplicationContext(AppModule);
  const dataSource = app.get(DataSource);
  const encryption = app.get(EncryptionService);
  const schoolRepository = dataSource.getRepository(School);

  let migrated = 0;
  let skipped = 0;

  const schools = await schoolRepository.find();

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
      await schoolRepository.save(school);
      migrated += 1;
    }
  }

  console.log(
    `Re-encryption complete: ${migrated} school(s) updated, ${skipped} field(s) skipped.`,
  );
  await app.close();

  return { migrated, skipped };
}

if (require.main === module) {
  reencryptSettings()
    .then(({ skipped }) => {
      if (skipped > 0) {
        console.error(
          `${skipped} field(s) could not be decrypted with any configured key — investigate before dropping SETTINGS_ENCRYPTION_KEY_PREVIOUS.`,
        );
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('settings:reencrypt failed:', err);
      process.exit(1);
    });
}
