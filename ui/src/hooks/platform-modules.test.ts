import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { cleanupTestState } from '../test/render-with-providers';

import {
  platformModulesKeys,
  schoolPlatformModulesKeys,
  usePlatformModules,
  useSchoolPlatformModules,
  useSetPlatformModules,
  useSetSchoolModuleLock,
} from './platform-modules';

const SCHOOL = '00000000-0000-4000-8000-000000000101';

afterEach(async () => {
  await cleanupTestState();
});

describe('platform module hooks', () => {
  it('query keys are separate per read', () => {
    expect(platformModulesKeys.all).toEqual(['platform-modules']);
    expect(schoolPlatformModulesKeys.detail(SCHOOL)).toEqual([
      'platform-school-modules',
      'detail',
      SCHOOL,
    ]);
  });

  it('usePlatformModules and useSchoolPlatformModules return the maps', async () => {
    server.use(
      http.get('*/platform/modules', () => HttpResponse.json({ modules: { fees: false } })),
      http.get('*/platform/schools/:id/modules', () =>
        HttpResponse.json({ modules: { fines: { on: true, lock: 'off' } } }),
      ),
    );
    const g = renderHookWithProviders(() => usePlatformModules());
    const s = renderHookWithProviders(() => useSchoolPlatformModules(SCHOOL));
    await waitFor(() => expect(g.result.current.data).toEqual({ fees: false }));
    await waitFor(() =>
      expect(s.result.current.data).toEqual({ fines: { on: true, lock: 'off' } }),
    );
  });

  it('useSetSchoolModuleLock PUTs exactly {lock}, then the school read refetches', async () => {
    const bodies: unknown[] = [];
    let reads = 0;
    server.use(
      http.get('*/platform/schools/:id/modules', () => {
        reads += 1;
        return HttpResponse.json({ modules: {} });
      }),
      http.put('*/platform/schools/:id/modules/:key/lock', async ({ request, params }) => {
        bodies.push([params.key, await request.json()]);
        return HttpResponse.json({});
      }),
    );
    const { result } = renderHookWithProviders(() => ({
      read: useSchoolPlatformModules(SCHOOL),
      write: useSetSchoolModuleLock(SCHOOL),
    }));
    await waitFor(() => expect(reads).toBe(1));
    await act(() => result.current.write.mutateAsync({ key: 'fees', lock: null }));
    expect(bodies).toEqual([['fees', { lock: null }]]);
    await waitFor(() => expect(reads).toBe(2));
  });

  it('useSetPlatformModules PUTs the full map, refetches, and a failure is not retried', async () => {
    const bodies: unknown[] = [];
    let reads = 0;
    let fail = false;
    server.use(
      http.get('*/platform/modules', () => {
        reads += 1;
        return HttpResponse.json({ modules: {} });
      }),
      http.put('*/platform/modules', async ({ request }) => {
        bodies.push(await request.json());
        return fail
          ? HttpResponse.json(
              { statusCode: 500, message: 'x', timestamp: '', path: '/', requestId: 'r' },
              { status: 500 },
            )
          : HttpResponse.json({ modules: {} });
      }),
    );
    const { result } = renderHookWithProviders(() => ({
      read: usePlatformModules(),
      write: useSetPlatformModules(),
    }));
    await waitFor(() => expect(reads).toBe(1));
    await act(() => result.current.write.mutateAsync({ modules: { fees: false, fines: false } }));
    expect(bodies).toEqual([{ modules: { fees: false, fines: false } }]);
    await waitFor(() => expect(reads).toBe(2));
    fail = true;
    await act(() => result.current.write.mutateAsync({ modules: {} }).catch(() => undefined));
    expect(bodies).toHaveLength(2);
  });
});
