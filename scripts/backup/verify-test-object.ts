/**
 * Restore-drill helper: asserts the object `upload-test-object.ts` wrote
 * before the backup still exists in the bucket after the restore-drill's
 * database restore. The bucket is never part of the Postgres dump/restore
 * cycle, so this simply confirms it survived unaffected — see
 * `upload-test-object.ts`'s comment for the full reasoning.
 *
 * Run via:
 *   yarn ts-node -P server/tsconfig.json scripts/backup/verify-test-object.ts <key>
 */
import { buildStorageConfig, StorageService } from '../../server/src/modules/storage/storage.service';

async function main(): Promise<void> {
  const key = process.argv[2];
  if (!key) {
    throw new Error('Usage: verify-test-object.ts <object-key>');
  }

  const storage = new StorageService(buildStorageConfig(process.env));
  const found = await storage.exists(key);

  if (!found) {
    throw new Error(`Object "${key}" was expected to still exist after restore, but does not.`);
  }

  // eslint-disable-next-line no-console
  console.log(`OK: ${key} still exists after restore`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
