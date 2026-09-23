import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  type GradingScale,
  useConfirmBands,
  useCopyGradingScale,
  useCreateGradingScale,
  useGradingScales,
  usePreviewBands,
} from './grading';

function scaleFactory(overrides: Partial<GradingScale> = {}): GradingScale {
  return {
    id: 'scale-1',
    academic_year_id: 'year-1',
    class_id: null,
    name: 'BD NCTB',
    revision: 1,
    bands: [],
    ...overrides,
  };
}

describe('useGradingScales', () => {
  it('resolves with every scale the handler returns', async () => {
    const scales = [scaleFactory({ id: 'scale-1' }), scaleFactory({ id: 'scale-2' })];
    server.use(http.get('/api/v1/grading/scales', () => HttpResponse.json(scales)));

    const { result } = renderHookWithProviders(() => useGradingScales(), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((s) => s.id)).toEqual(['scale-1', 'scale-2']);
  });
});

describe('useCreateGradingScale', () => {
  it('posts the new scale and invalidates the list', async () => {
    server.use(
      http.post('/api/v1/grading/scales', () => HttpResponse.json(scaleFactory(), { status: 201 })),
    );

    const { result } = renderHookWithProviders(() => useCreateGradingScale(), {
      tenantId: 'tenant-1',
    });

    result.current.mutate({ academic_year_id: 'year-1', name: 'BD NCTB' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('usePreviewBands', () => {
  it('reports problems and affected count without writing anything', async () => {
    server.use(
      http.post('/api/v1/grading/scales/scale-1/bands/preview', () =>
        HttpResponse.json({
          valid: false,
          problems: [{ type: 'gap', message: 'Gap between 50 and 60' }],
          bands_changed: true,
          affected_result_count: 0,
        }),
      ),
    );

    const { result } = renderHookWithProviders(() => usePreviewBands('scale-1'), {
      tenantId: 'tenant-1',
    });

    result.current.mutate([]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.valid).toBe(false);
    expect(result.current.data?.problems).toHaveLength(1);
  });
});

describe('useConfirmBands', () => {
  it('replaces the band set once an approval token is already present', async () => {
    server.use(
      http.post('/api/v1/grading/scales/scale-1/bands/confirm', () =>
        HttpResponse.json({ scale: scaleFactory({ revision: 2 }), affected_result_count: 3 }),
      ),
    );

    const { result } = renderHookWithProviders(() => useConfirmBands('scale-1'), {
      tenantId: 'tenant-1',
    });

    result.current.mutate([]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.scale.revision).toBe(2);
    expect(result.current.data?.affected_result_count).toBe(3);
  });
});

describe('useCopyGradingScale', () => {
  it('refuses an occupied target — surfaces the server 409 as a mutation error', async () => {
    server.use(
      http.post('/api/v1/grading/scales/scale-2/copy', () =>
        HttpResponse.json({ message: 'Target scale already has bands' }, { status: 409 }),
      ),
    );

    const { result } = renderHookWithProviders(() => useCopyGradingScale('scale-2'), {
      tenantId: 'tenant-1',
    });

    result.current.mutate({ source_scale_id: 'scale-1' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
