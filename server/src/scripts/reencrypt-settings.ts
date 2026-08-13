import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { School } from '../modules/schools/entities/school.entity';
import { EncryptionService } from '../modules/schools/settings/encryption.service';
import { BATCH_SIZE, migrateSchools } from './reencrypt-settings.util';

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
 * Includes soft-deleted schools (`withDeleted: true`) — a school can be
 * restored later, and a restored school whose secrets were silently
 * skipped here would be left permanently unable to decrypt them once
 * `SETTINGS_ENCRYPTION_KEY_PREVIOUS` is dropped.
 *
 * Paginates through schools `BATCH_SIZE` at a time rather than loading
 * every row (and its settings jsonb) into memory in one `find()`.
 *
 * Safe to re-run: each school is loaded, migrated, and saved independently,
 * and a school with nothing left to migrate isn't re-saved (see
 * `migrateSchools`), so an interruption only costs re-processing whatever
 * batch was in flight.
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
  let skip = 0;

  for (;;) {
    const batch = await schoolRepository.find({
      withDeleted: true,
      order: { id: 'ASC' },
      skip,
      take: BATCH_SIZE,
    });
    if (batch.length === 0) break;

    const result = await migrateSchools(batch, encryption, async (school) => {
      await schoolRepository.save(school as School);
    });
    migrated += result.migrated;
    skipped += result.skipped;

    skip += BATCH_SIZE;
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
