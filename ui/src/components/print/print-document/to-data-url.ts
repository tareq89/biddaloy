/** Fetches through the authenticated client and returns a `data:` URL. Concurrent calls for one url share a request. */
export type BlobFetcher = (url: string) => Promise<Blob>;

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });

/** Pass one `cache` Map per document build. */
export function fetchAsDataUrl(
  url: string,
  fetcher: BlobFetcher,
  cache: Map<string, Promise<string>> = new Map(),
): Promise<string> {
  if (url.startsWith('data:')) return Promise.resolve(url);
  let hit = cache.get(url);
  if (!hit) {
    hit = fetcher(url).then(toDataUrl);
    cache.set(url, hit);
  }
  return hit;
}
