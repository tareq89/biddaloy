/**
 * [9.6] `useSubmitRegister` is 8.12's offline mutation queue's first real
 * caller — these tests exercise the online/offline/no-response/conflict
 * contract described on the hook itself. `enqueueMutation` is mocked so
 * each case asserts *whether* it was called and with what, rather than
 * standing up a real Dexie/tenant for a unit test.
 */
import { AttendanceStatus } from '@biddaloy/shared';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  useMySections,
  useSectionRegister,
  useSubmitRegister,
  type PutRegisterInput,
} from './attendance';

const { enqueueMutationMock } = vi.hoisted(() => ({ enqueueMutationMock: vi.fn() }));

vi.mock('../api/mutation-queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/mutation-queue')>();
  return { ...actual, enqueueMutation: enqueueMutationMock };
});

function buildInput(): PutRegisterInput {
  return {
    date: '2026-09-04',
    base_version: 0,
    client_request_id: crypto.randomUUID(),
    entries: [{ student_id: 'student-1', status: AttendanceStatus.PRESENT }],
  };
}

const originalOnLine = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');

function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
}

beforeEach(() => {
  enqueueMutationMock.mockReset();
  enqueueMutationMock.mockResolvedValue({ seq: 1 });
  setOnline(true);
});

afterEach(() => {
  if (originalOnLine) Object.defineProperty(window.navigator, 'onLine', originalOnLine);
});

describe('useMySections', () => {
  it("resolves the teacher's server-scoped section list", async () => {
    server.use(
      http.get('/api/v1/attendance/my-sections', () =>
        HttpResponse.json([
          {
            section_id: 'section-1',
            section_name: 'A',
            class_name: 'Class 5',
            student_count: 40,
            today: null,
          },
        ]),
      ),
    );
    const { result } = renderHookWithProviders(() => useMySections(), { tenantId: 'tenant-1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.section_name).toBe('A');
  });
});

describe('useSectionRegister', () => {
  it('resolves the register for a section/date', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json({
          section: { id: 'section-1', section_name: 'A', class_name: 'Class 5' },
          session: {
            id: null,
            date: '2026-09-04',
            period_no: null,
            state: 'DRAFT',
            version: 0,
            marked_by_user_id: null,
            marked_at: null,
            finalized_at: null,
          },
          editable: true,
          reason_required: false,
          non_working_day: false,
          policy: { late_after: '09:00', correction_window_days: 3, allow_future_dates: false },
          students: [],
        }),
      ),
    );
    const { result } = renderHookWithProviders(
      () => useSectionRegister('section-1', '2026-09-04'),
      { tenantId: 'tenant-1' },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.section.section_name).toBe('A');
  });
});

describe('useSubmitRegister', () => {
  it('online: sends PUT and resolves { queued: false, register }', async () => {
    server.use(
      http.put('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json({
          section: { id: 'section-1', section_name: 'A', class_name: 'Class 5' },
          session: {
            id: 'session-1',
            date: '2026-09-04',
            period_no: null,
            state: 'DRAFT',
            version: 1,
            marked_by_user_id: 'user-1',
            marked_at: '2026-09-04T00:00:00.000Z',
            finalized_at: null,
          },
          editable: true,
          reason_required: false,
          non_working_day: false,
          policy: { late_after: '09:00', correction_window_days: 3, allow_future_dates: false },
          students: [],
        }),
      ),
    );
    const { result } = renderHookWithProviders(() => useSubmitRegister('section-1'), {
      tenantId: 'tenant-1',
    });
    result.current.mutate(buildInput());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      queued: false,
      register: expect.objectContaining({ session: expect.objectContaining({ version: 1 }) }),
    });
    expect(enqueueMutationMock).not.toHaveBeenCalled();
  });

  it('offline (navigator.onLine = false): enqueues instead of sending', async () => {
    setOnline(false);
    const { result } = renderHookWithProviders(() => useSubmitRegister('section-1'), {
      tenantId: 'tenant-1',
    });
    const input = buildInput();
    result.current.mutate(input);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ queued: true });
    expect(enqueueMutationMock).toHaveBeenCalledWith({
      entity: 'attendance',
      method: 'put',
      path: '/attendance/sections/section-1/register',
      body: input,
    });
  });

  it('online but no-response network error: enqueues instead of throwing', async () => {
    server.use(
      http.put('/api/v1/attendance/sections/section-1/register', () => HttpResponse.error()),
    );
    const { result } = renderHookWithProviders(() => useSubmitRegister('section-1'), {
      tenantId: 'tenant-1',
    });
    const input = buildInput();
    result.current.mutate(input);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ queued: true });
    expect(enqueueMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'attendance', method: 'put' }),
    );
  });

  it('409 conflict: propagates to the caller, never queued', async () => {
    server.use(
      http.put('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(
          apiErrorBody(
            409,
            'This register changed since you last loaded it',
            '/attendance/sections/section-1/register',
          ),
          { status: 409 },
        ),
      ),
    );
    const { result } = renderHookWithProviders(() => useSubmitRegister('section-1'), {
      tenantId: 'tenant-1',
    });
    result.current.mutate(buildInput());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(enqueueMutationMock).not.toHaveBeenCalled();
  });

  it('enqueueMutation throwing QueueUnavailableError propagates, not swallowed', async () => {
    setOnline(false);
    const { QueueUnavailableError } = await import('../api/mutation-queue');
    enqueueMutationMock.mockRejectedValueOnce(new QueueUnavailableError('no tenant is active'));
    const { result } = renderHookWithProviders(() => useSubmitRegister('section-1'), {
      tenantId: 'tenant-1',
    });
    result.current.mutate(buildInput());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(QueueUnavailableError);
  });
});
