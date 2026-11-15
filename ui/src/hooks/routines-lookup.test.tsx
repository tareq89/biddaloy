import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { usePeriodSlotLookup, useSectionLookup } from './routines';

const fail = () => HttpResponse.json({ message: 'boom' }, { status: 500 });

describe('routine lookups surface a failed parent list as an error (#1019)', () => {
  it('usePeriodSlotLookup errors, never stays pending, when shifts fail', async () => {
    server.use(http.get('/api/v1/routines/shifts', fail));
    const { result } = renderHookWithProviders(() => usePeriodSlotLookup(), {
      tenantId: 'tenant-1',
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('useSectionLookup errors, never stays pending, when classes fail', async () => {
    server.use(http.get('/api/v1/classes', fail));
    const { result } = renderHookWithProviders(() => useSectionLookup(), {
      tenantId: 'tenant-1',
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
