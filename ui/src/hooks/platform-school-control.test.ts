import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { ApiError } from '../api/errors';
import { server } from '../test/msw/server';
import { errorHandler } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { cleanupTestState } from '../test/render-with-providers';

import {
  useAddSchoolNote,
  useArchiveExportStatus,
  useLogoutAllSchool,
  usePlatformSchoolList,
  useRenameSchool,
  useSchoolNotes,
  useSchoolOverview,
  useSendAdminResetLink,
} from './platform-school-control';

afterEach(async () => {
  await cleanupTestState();
});

const SCHOOL = '00000000-0000-4000-8000-000000000101';

describe('platform school control hooks', () => {
  it('usePlatformSchoolList: loading, rows, filters sent, limit capped', async () => {
    let qs = new URLSearchParams();
    server.use(
      http.get('*/platform/schools/search', ({ request }) => {
        qs = new URL(request.url).searchParams;
        return HttpResponse.json({ items: [], total: 0 });
      }),
    );
    const { result } = renderHookWithProviders(() =>
      usePlatformSchoolList({ trial: 'expired', limit: 1000 }),
    );
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qs.get('trial')).toBe('expired');
    expect(qs.get('limit')).toBe('100');
  });

  it('usePlatformSchoolList: default limit is 25', async () => {
    let limit: string | null = null;
    server.use(
      http.get('*/platform/schools/search', ({ request }) => {
        limit = new URL(request.url).searchParams.get('limit');
        return HttpResponse.json({ items: [], total: 0 });
      }),
    );
    const { result } = renderHookWithProviders(() => usePlatformSchoolList());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(limit).toBe('25');
  });

  it('useSchoolOverview: 500 surfaces as an error; success returns the admins', async () => {
    const ok = renderHookWithProviders(() => useSchoolOverview(SCHOOL));
    await waitFor(() => expect(ok.result.current.isSuccess).toBe(true));
    expect(ok.result.current.data?.admins).toHaveLength(1);

    server.use(errorHandler('get', '*/platform/schools/:id/overview', 500));
    const bad = renderHookWithProviders(() => useSchoolOverview('other'));
    await waitFor(() => expect(bad.result.current.isError).toBe(true));
  });

  it('useSchoolNotes + useAddSchoolNote', async () => {
    const list = renderHookWithProviders(() => useSchoolNotes(SCHOOL));
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    const add = renderHookWithProviders(() => useAddSchoolNote(SCHOOL));
    const note = await act(() => add.result.current.mutateAsync({ text: 'hello' }));
    expect(note.text).toBe('hello');
  });

  it('useLogoutAllSchool and useSendAdminResetLink succeed', async () => {
    const out = renderHookWithProviders(() => useLogoutAllSchool(SCHOOL));
    expect(await act(() => out.result.current.mutateAsync())).toEqual({ usersSignedOut: 14 });
    const link = renderHookWithProviders(() => useSendAdminResetLink(SCHOOL));
    const r = await act(() => link.result.current.mutateAsync({ userId: 'u1' }));
    expect(r.channel).toBe('EMAIL');
  });

  it('useRenameSchool: a 409 is an ApiError and is not retried', async () => {
    let calls = 0;
    server.use(
      http.patch('*/platform/schools/:id/name', () => {
        calls += 1;
        return HttpResponse.json(
          { statusCode: 409, message: 'x', timestamp: '', path: '/', requestId: 'r' },
          { status: 409 },
        );
      }),
    );
    const { result } = renderHookWithProviders(() => useRenameSchool(SCHOOL));
    act(() => result.current.mutate({ name: 'New', reason: 'Typo in the name' }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).statusCode).toBe(409);
    expect(calls).toBe(1);
  });

  it('useArchiveExportStatus: reads a finished export', async () => {
    const { result } = renderHookWithProviders(() => useArchiveExportStatus(SCHOOL, 'job-1'));
    await waitFor(() => expect(result.current.data?.status).toBe('DONE'));
  });
});
