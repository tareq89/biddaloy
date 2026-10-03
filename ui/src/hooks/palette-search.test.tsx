import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { usePaletteSearch } from './palette-search';

function mockSearch() {
  let calls = 0;
  server.use(
    http.get('/api/v1/search', () => {
      calls += 1;
      return HttpResponse.json({ students: [{ id: 's1', full_name: 'Karim' }] });
    }),
  );
  return () => calls;
}

describe('usePaletteSearch', () => {
  it('calls /search for a role holding STUDENT_READ', async () => {
    const calls = mockSearch();
    const { result } = renderHookWithProviders(() => usePaletteSearch('kar'), {
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    await waitFor(() => expect(result.current.students).toHaveLength(1));
    expect(calls()).toBe(1);
  });

  it('never calls /search for COMMITTEE (no STUDENT_READ)', async () => {
    const calls = mockSearch();
    const { result } = renderHookWithProviders(() => usePaletteSearch('kar'), {
      tenantId: 'tenant-1',
      role: 'COMMITTEE',
    });

    // Let any (wrongly) enabled query fire before asserting it did not.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls()).toBe(0);
    expect(result.current.students).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });
});
