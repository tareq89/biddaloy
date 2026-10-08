import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { seatPlansQueryOptions, useSeatPlans } from './seat-plans';

describe('useSeatPlans', () => {
  it('calls /seat-plans with no params by default, and sends exam_id when filtered', async () => {
    const searches: string[] = [];
    server.use(
      http.get('/api/v1/seat-plans', ({ request }) => {
        searches.push(new URL(request.url).search);
        return HttpResponse.json([]);
      }),
    );
    const all = renderHookWithProviders(() => useSeatPlans(), { tenantId: 'tenant-1' });
    await waitFor(() => expect(all.result.current.isSuccess).toBe(true));
    const one = renderHookWithProviders(() => useSeatPlans({ examId: 'e-1' }), {
      tenantId: 'tenant-1',
    });
    await waitFor(() => expect(one.result.current.isSuccess).toBe(true));
    expect(searches).toEqual(['', '?exam_id=e-1']);
  });

  it('keys the filtered and unfiltered lists differently', () => {
    expect(seatPlansQueryOptions().queryKey).not.toEqual(
      seatPlansQueryOptions({ examId: 'e-1' }).queryKey,
    );
  });
});
