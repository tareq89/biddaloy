import { waitFor } from '@testing-library/react';
import type { AxiosResponse } from 'axios';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setActiveTenant } from '../api/auth-state';
import { apiClient } from '../api/client';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { cleanupTestState } from '../test/render-with-providers';

import {
  ExportTooLargeError,
  downloadCollectionsReportCsv,
  downloadListExport,
  downloadStudentCountExport,
  useCollectionsReport,
  useStudentCount,
} from './reports';

afterEach(async () => {
  await cleanupTestState();
});

const FILTERS = {
  from: '2026-09-01',
  to: '2026-09-16',
  payment_method: 'CASH',
  received_by_user_id: 'u-1',
} as const;

function expectServerParams(query: URLSearchParams | null) {
  expect(Object.fromEntries(query!.entries())).toEqual({
    from: '2026-09-01',
    to: '2026-09-16',
    payment_method: 'CASH',
    received_by_user_id: 'u-1',
  });
}

describe('collections report hooks', () => {
  it('useCollectionsReport sends the server parameter names', async () => {
    let query: URLSearchParams | null = null;
    server.use(
      http.get('/api/v1/reports/collections', ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json({});
      }),
    );
    const { result } = renderHookWithProviders(() => useCollectionsReport(FILTERS), {
      tenantId: 'tenant-1',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expectServerParams(query);
  });

  it('downloadCollectionsReportCsv sends the same parameters', async () => {
    let query: URLSearchParams | null = null;
    server.use(
      http.get('/api/v1/reports/collections.csv', ({ request }) => {
        query = new URL(request.url).searchParams;
        return new HttpResponse('a,b', { headers: { 'Content-Type': 'text/csv' } });
      }),
    );
    setActiveTenant('tenant-1');
    // Saved only to restore them below; never called unbound.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { createObjectURL, revokeObjectURL } = URL;
    URL.createObjectURL = () => 'blob:x';
    URL.revokeObjectURL = () => undefined;
    try {
      await downloadCollectionsReportCsv(FILTERS);
    } finally {
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    }
    expectServerParams(query);
  });
});

/**
 * These tests stub `apiClient.get` instead of using MSW: a `responseType: 'blob'` request through
 * MSW's XHR interceptor fails in this jsdom (its `Response` cannot take a jsdom `Blob`), including
 * the older `downloadCollectionsReportCsv` test above, so the download path is covered one layer up.
 */
interface SentRequest {
  url: string;
  params: Record<string, string>;
}

function stubGet(respond: () => Partial<AxiosResponse<unknown>>) {
  const sent: SentRequest[] = [];
  vi.spyOn(apiClient, 'get').mockImplementation((url, config) => {
    sent.push({ url, params: (config?.params ?? {}) as Record<string, string> });
    return Promise.resolve({
      status: 200,
      headers: {},
      data: new Blob(['x']),
      ...respond(),
    } as never);
  });
  return sent;
}

/** jsdom has no `URL.createObjectURL`; stub it, click nothing, and hand back what was saved. */
async function withStubbedDownload(run: () => Promise<void>) {
  const saved: { blob?: Blob; filename?: string } = {};
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { createObjectURL, revokeObjectURL } = URL;
  URL.createObjectURL = (blob) => {
    saved.blob = blob as Blob;
    return 'blob:x';
  };
  URL.revokeObjectURL = () => undefined;
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.filename = this.download;
  });
  try {
    await run();
  } finally {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    click.mockRestore();
  }
  return saved;
}

describe('downloadListExport [8.15.17]', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the list filters plus format, drops paging and empty values, and saves the file', async () => {
    const sent = stubGet(() => ({
      data: new Blob(['xlsx-bytes']),
      headers: { 'content-disposition': 'attachment; filename="dues.xlsx"' },
    }));
    const saved = await withStubbedDownload(() =>
      downloadListExport(
        '/fees/dues/export',
        { class_id: 'class-7', search: '', month: 3, page: 4, limit: 25, flagged: undefined },
        'xlsx',
      ),
    );
    expect(sent).toEqual([
      {
        url: '/fees/dues/export',
        params: { class_id: 'class-7', month: '3', format: 'XLSX' },
      },
    ]);
    expect(saved.filename).toBe('dues.xlsx');
    expect(await saved.blob!.text()).toBe('xlsx-bytes');
  });

  it('asks for CSV when told to, and falls back to a file name when the server gives none', async () => {
    const sent = stubGet(() => ({}));
    const saved = await withStubbedDownload(() =>
      downloadListExport('/students/export', {}, 'csv'),
    );
    expect(sent[0]?.params.format).toBe('CSV');
    expect(saved.filename).toBe('students.csv');
  });

  it('accepts a 413 as a response so its body can be read', async () => {
    stubGet(() => ({}));
    await withStubbedDownload(() => downloadListExport('/payments/export', {}, 'xlsx'));
    // eslint-disable-next-line @typescript-eslint/unbound-method -- a spy's recorded calls, never called unbound
    const config = vi.mocked(apiClient.get).mock.calls[0]?.[1];
    expect(config?.responseType).toBe('blob');
    expect(config?.validateStatus?.(413)).toBe(true);
    expect(config?.validateStatus?.(200)).toBe(true);
    expect(config?.validateStatus?.(403)).toBe(false);
  });

  it('throws ExportTooLargeError carrying the row cap on 413 EXPORT_TOO_LARGE', async () => {
    stubGet(() => ({
      status: 413,
      data: new Blob([
        JSON.stringify({
          statusCode: 413,
          message: 'Too many rows',
          details: { code: 'EXPORT_TOO_LARGE', rows: 5000 },
        }),
      ]),
    }));
    const error = await downloadListExport('/payments/export', {}, 'xlsx').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExportTooLargeError);
    expect((error as ExportTooLargeError).rows).toBe(5000);
    expect((error as ExportTooLargeError).code).toBe('EXPORT_TOO_LARGE');
  });

  it('defaults the cap to 5,000 when the 413 body names none', async () => {
    stubGet(() => ({
      status: 413,
      data: new Blob([JSON.stringify({ details: { code: 'EXPORT_TOO_LARGE' } })]),
    }));
    const error = await downloadListExport('/students/export', {}, 'xlsx').catch((e: unknown) => e);
    expect((error as ExportTooLargeError).rows).toBe(5000);
  });

  it('throws a plain error, not ExportTooLargeError, for a 413 that is not ours', async () => {
    stubGet(() => ({ status: 413, data: new Blob(['<html>nginx</html>']) }));
    const error = await downloadListExport('/invoices/export', {}, 'xlsx').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ExportTooLargeError);
  });
});

describe('student count [8.15.54]', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('useStudentCount asks for the current year when no year is given', async () => {
    let query: URLSearchParams | null = null;
    server.use(
      http.get('/api/v1/reports/student-count', ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json({ rows: [] });
      }),
    );
    const { result } = renderHookWithProviders(() => useStudentCount(), { tenantId: 'tenant-1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(query!.has('academic_year_id')).toBe(false);
  });

  it('useStudentCount sends the chosen year', async () => {
    let query: URLSearchParams | null = null;
    server.use(
      http.get('/api/v1/reports/student-count', ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json({ rows: [] });
      }),
    );
    const { result } = renderHookWithProviders(() => useStudentCount('year-1'), {
      tenantId: 'tenant-1',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(query!.get('academic_year_id')).toBe('year-1');
  });

  it('downloadStudentCountExport sends year, format and table', async () => {
    const sent = stubGet(() => ({}));
    const saved = await withStubbedDownload(() =>
      downloadStudentCountExport({ academicYearId: 'year-1', format: 'csv', table: 'staff' }),
    );
    expect(sent).toEqual([
      {
        url: '/reports/student-count/export',
        params: { academic_year_id: 'year-1', format: 'CSV', table: 'staff' },
      },
    ]);
    expect(saved.filename).toBe('student-count-staff.csv');
  });

  it('downloadStudentCountExport defaults to the Excel students table of the current year', async () => {
    const sent = stubGet(() => ({}));
    await withStubbedDownload(() => downloadStudentCountExport({}));
    expect(sent[0]?.params).toEqual({ format: 'XLSX', table: 'students' });
  });
});
