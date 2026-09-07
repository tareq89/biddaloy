/**
 * Restore-drill helper: uploads a tiny 1x1 PNG through `StorageService`
 * (not a raw `S3Client` call) before the backup step runs, using the same
 * `tenantObjectKey` construction any real consumer would. The object store
 * is not part of the Postgres dump — `restore-drill.yml` uses this to
 * prove the bucket itself is the durable store for it, separately from
 * the database backup/restore path.
 *
 * Run via: `yarn ts-node -P server/tsconfig.json scripts/backup/upload-test-object.ts`
 * Prints `key=<the generated object key>` on the last line of stdout —
 * restore-drill.yml captures it with a `GITHUB_OUTPUT` grep.
 */
import { buildStorageConfig, StorageService } from '../../server/src/modules/storage/storage.service';
import { tenantObjectKey } from '../../server/src/modules/storage/storage-key';

// A minimal valid 1x1 transparent PNG, inlined so this script has no
// external file dependency.
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function main(): Promise<void> {
  const storage = new StorageService(buildStorageConfig(process.env));
  // A fixed, valid-looking UUID stands in for a real tenant id — this
  // drill doesn't depend on any actual school row existing.
  const key = tenantObjectKey('00000000-0000-4000-8000-000000000000', 'logos', 'png');

  await storage.put(key, ONE_PIXEL_PNG, 'image/png');

  // eslint-disable-next-line no-console
  console.log(`key=${key}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
