/**
 * [8.15.17] Test helper for the "download everything that matches" button on the six list screens.
 *
 * Stubs `apiClient.get` for `.../export` URLs instead of using MSW: a `responseType: 'blob'`
 * request through MSW's XHR interceptor fails in this jsdom (its `Response` cannot take a jsdom
 * `Blob`). Every other request still goes to MSW. Also stubs the object-URL save, so nothing is
 * actually downloaded.
 */
import { apiClient } from '@biddaloy/ui/api';
import { vi } from 'vitest';

export interface SentExport {
  url: string;
  params: Record<string, string>;
}

/** What the stubbed export route answers: a file, or the server's HTTP 413 `EXPORT_TOO_LARGE`. */
export type ExportAnswer = 'file' | 'too-large';

export function stubExportDownload(answer: ExportAnswer = 'file') {
  const sent: SentExport[] = [];
  const real = apiClient.get.bind(apiClient);
  const get = vi.spyOn(apiClient, 'get').mockImplementation(((
    url: string,
    config?: { params?: Record<string, string> },
  ) => {
    if (!url.includes('/export')) return real(url, config);
    sent.push({ url, params: { ...config?.params } });
    return Promise.resolve(
      answer === 'file'
        ? { status: 200, headers: {}, data: new Blob(['file']) }
        : {
            status: 413,
            headers: {},
            data: new Blob([JSON.stringify({ details: { code: 'EXPORT_TOO_LARGE', rows: 5000 } })]),
          },
    );
  }) as typeof apiClient.get);
  URL.createObjectURL = () => 'blob:mock';
  URL.revokeObjectURL = () => undefined;
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  return {
    sent,
    restore() {
      get.mockRestore();
      click.mockRestore();
      delete (URL as { createObjectURL?: unknown }).createObjectURL;
      delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
    },
  };
}
