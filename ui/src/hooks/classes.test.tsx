import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { classFactory, classSectionFactory } from '../test/factories';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { useClasses, useClassSections } from './classes';

describe("useClasses resolves the tenant's class list for a filter dropdown", () => {
  it('resolves with every class the handler returns', async () => {
    const classes = [classFactory({ name: 'Class 5' }), classFactory({ name: 'Class 8' })];
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: classes, total: 2, page: 1, limit: 100, totalPages: 1 }),
      ),
    );

    const { result } = renderHookWithProviders(() => useClasses(), { tenantId: 'tenant-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data.map((c) => c.name)).toEqual(['Class 5', 'Class 8']);
  });

  it('requests a high limit — this list backs a <select>, not a paginated table', async () => {
    let requestedLimit: string | null = null;
    server.use(
      http.get('/api/v1/classes', ({ request }) => {
        requestedLimit = new URL(request.url).searchParams.get('limit');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 });
      }),
    );

    const { result } = renderHookWithProviders(() => useClasses(), { tenantId: 'tenant-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedLimit).toBe('100');
  });
});

describe("useClassSections resolves a class's sections and stays disabled without a classId", () => {
  it('resolves with the sections the handler returns for that class', async () => {
    const sections = [
      classSectionFactory({ section_name: 'A', class_id: 'class-1' }),
      classSectionFactory({ section_name: 'B', class_id: 'class-1' }),
    ];
    server.use(http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json(sections)));

    const { result } = renderHookWithProviders(() => useClassSections('class-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((s) => s.section_name)).toEqual(['A', 'B']);
  });

  it('never fires a request when classId is undefined — "All classes" has no sections to fetch', async () => {
    let callCount = 0;
    server.use(
      http.get('/api/v1/classes/:classId/sections', () => {
        callCount += 1;
        return HttpResponse.json([]);
      }),
    );

    const { result } = renderHookWithProviders(() => useClassSections(undefined), {
      tenantId: 'tenant-1',
    });

    // Give the query every chance to (incorrectly) fire before asserting
    // it never did.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.fetchStatus).toBe('idle');
    expect(callCount).toBe(0);
  });
});
