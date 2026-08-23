import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { useFeeDues } from './fee-dues';

const EMPTY_PAGE = { data: [], total: 0, page: 1, limit: 10, totalPages: 0 };

describe('useFeeDues', () => {
  it('calls GET /fees/dues with the full filter set when flagged is false', async () => {
    const seen: Record<string, string | null> = {};
    server.use(
      http.get('/api/v1/fees/dues', ({ request }) => {
        const params = new URL(request.url).searchParams;
        seen.class_id = params.get('class_id');
        seen.month = params.get('month');
        seen.sort_by = params.get('sort_by');
        return HttpResponse.json(EMPTY_PAGE);
      }),
    );

    const { result } = renderHookWithProviders(
      () => useFeeDues({ class_id: 'class-1', month: 3, year: 2026, sort_by: 'name' }, false),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen.class_id).toBe('class-1');
    expect(seen.month).toBe('3');
    expect(seen.sort_by).toBe('name');
  });

  it('calls GET /fees/dues/flagged and strips month/year/status/sort when flagged is true', async () => {
    const seen: Record<string, string | null | boolean> = {};
    server.use(
      http.get('/api/v1/fees/dues/flagged', ({ request }) => {
        const params = new URL(request.url).searchParams;
        seen.class_id = params.get('class_id');
        seen.section_id = params.get('section_id');
        seen.hasMonth = params.has('month');
        seen.hasYear = params.has('year');
        seen.hasSortBy = params.has('sort_by');
        return HttpResponse.json(EMPTY_PAGE);
      }),
    );

    const { result } = renderHookWithProviders(
      () =>
        useFeeDues(
          { class_id: 'class-1', section_id: 'section-1', month: 3, year: 2026, sort_by: 'name' },
          true,
        ),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen.class_id).toBe('class-1');
    expect(seen.section_id).toBe('section-1');
    expect(seen.hasMonth).toBe(false);
    expect(seen.hasYear).toBe(false);
    expect(seen.hasSortBy).toBe(false);
  });

  it('resolves the paginated dues rows', async () => {
    server.use(
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({
          data: [
            {
              student_id: 'student-1',
              full_name: 'Karim Rahman',
              registration_number: 'REG-1',
              roll_number: 1,
              class_name: 'Class 5',
              section_name: 'A',
              total_due: 500,
              months_overdue: 0,
              dues: [],
            },
          ],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
    );

    const { result } = renderHookWithProviders(() => useFeeDues(), { tenantId: 'tenant-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(1);
    expect(result.current.data?.data[0]?.full_name).toBe('Karim Rahman');
  });
});
