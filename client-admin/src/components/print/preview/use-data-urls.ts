import { apiClient } from '@biddaloy/ui/api';
import { fetchAsDataUrl } from '@biddaloy/ui/components';
import { useQueries } from '@tanstack/react-query';

/**
 * Loads authenticated images (photos, artwork) as `data:` URLs so the preview can
 * show them: a bare `<img src>` sends no bearer token. Returns url -> data URL for
 * the ones that have arrived; the rest are simply absent.
 */
export function useDataUrls(urls: string[]): Record<string, string> {
  const unique = [...new Set(urls.filter(Boolean))];
  return useQueries({
    queries: unique.map((url) => ({
      queryKey: ['print-preview-image', url] as const,
      queryFn: () =>
        fetchAsDataUrl(
          url,
          async (u) => (await apiClient.get<Blob>(u, { responseType: 'blob' })).data,
        ),
      staleTime: Infinity,
    })),
    combine: (results) =>
      Object.fromEntries(
        results.flatMap((result, i) => (result.data ? [[unique[i] as string, result.data]] : [])),
      ),
  });
}
