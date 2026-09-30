import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { cleanupTestState } from '../test/render-with-providers';

import { useAdmissionLifecycleReport } from './admission-reports';

afterEach(async () => {
  await cleanupTestState();
});

const REPORT = {
  counts: { admitted: 1, withdrawn: 0, transferred_out: 0, graduated: 0, readmitted: 0 },
  rows: [],
  truncated: false,
};

describe('useAdmissionLifecycleReport', () => {
  it('sends snake_case params and returns the report', async () => {
    let query: URLSearchParams | null = null;
    server.use(
      http.get('/api/v1/admission/reports/lifecycle', ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json(REPORT);
      }),
    );
    const { result } = renderHookWithProviders(
      () => useAdmissionLifecycleReport({ academicYearId: 'y1', classId: 'c1' }),
      { tenantId: 'tenant-1' },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.counts.admitted).toBe(1);
    expect(query!.get('academic_year_id')).toBe('y1');
    expect(query!.get('class_id')).toBe('c1');
  });

  it('does not fetch without an academic year', () => {
    const { result } = renderHookWithProviders(
      () => useAdmissionLifecycleReport({ academicYearId: '' }),
      { tenantId: 'tenant-1' },
    );
    expect(result.current.fetchStatus).toBe('idle');
  });
});
