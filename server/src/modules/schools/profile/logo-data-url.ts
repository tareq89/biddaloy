import type { Readable } from 'stream';
import { StorageService } from '../../storage/storage.service';
import { isMissingObjectError } from './logo.service';

/**
 * [15.5.7] Reads a logo object and returns it as a `data:` URL, for
 * embedding straight into server-rendered print HTML. That HTML is opened
 * by the client as a `blob:` document, where a relative `<img src>` can't
 * resolve and, even if it could, wouldn't carry the bearer token
 * `GET /schools/:id/logo` requires — inlining the bytes is the only way the
 * logo renders there at all.
 *
 * `null` (not a throw) for a missing object: a document whose logo object
 * is gone should still print, just text-only.
 */
export async function readLogoDataUrl(
  storage: StorageService,
  logoKey: string | null,
): Promise<string | null> {
  if (!logoKey) return null;
  let object: { body: Readable; contentType: string | undefined };
  try {
    object = await storage.get(logoKey);
  } catch (error: unknown) {
    if (isMissingObjectError(error)) return null;
    throw error;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of object.body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return `data:${object.contentType ?? 'image/png'};base64,${Buffer.concat(chunks).toString('base64')}`;
}
