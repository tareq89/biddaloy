import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  useCreateStaffHrRecord,
  useDesignations,
  usePromoteStaff,
  useStaffDesignationHistory,
  useStaffHrRecord,
  useUpdateStaffHrRecord,
  type StaffDesignationHistory,
  type StaffHrRecord,
} from './staff-hr';

const hrRecord: StaffHrRecord = {
  id: 'hr-1',
  user_id: 'user-1',
  index_no: null,
  salary_code: null,
  mpo_date: null,
  salary_scale: null,
  department: 'Science',
  blood_group: null,
  religion: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const historyRow: StaffDesignationHistory = {
  id: 'hist-1',
  user_id: 'user-1',
  designation_id: 'designation-1',
  effective_date: '2026-01-01',
  end_date: null,
  status: 'REGULAR',
  notes: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('useStaffHrRecord', () => {
  it('filters by user_id and resolves the one record', async () => {
    let params: URLSearchParams | null = null;
    server.use(
      http.get('/api/v1/staff-hr-records', ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json([hrRecord]);
      }),
    );

    const { result } = renderHookWithProviders(() => useStaffHrRecord('user-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(params!.get('user_id')).toBe('user-1');
    expect(result.current.data?.id).toBe('hr-1');
  });

  it('resolves null when no record exists yet', async () => {
    server.use(http.get('/api/v1/staff-hr-records', () => HttpResponse.json([])));

    const { result } = renderHookWithProviders(() => useStaffHrRecord('user-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

describe('useStaffDesignationHistory', () => {
  it('resolves the full history list', async () => {
    server.use(
      http.get('/api/v1/staff-hr-records/user-1/designation-history', () =>
        HttpResponse.json([historyRow]),
      ),
    );

    const { result } = renderHookWithProviders(() => useStaffDesignationHistory('user-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([historyRow]);
  });
});

describe('useDesignations', () => {
  it('resolves the tenant designation list', async () => {
    server.use(
      http.get('/api/v1/designations', () =>
        HttpResponse.json([
          { id: 'd-1', title_en: 'Accountant', title_bn: null, is_teaching: false },
        ]),
      ),
    );

    const { result } = renderHookWithProviders(() => useDesignations(), { tenantId: 'tenant-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.title_en).toBe('Accountant');
  });
});

describe('useCreateStaffHrRecord / useUpdateStaffHrRecord', () => {
  it('POSTs a new record', async () => {
    let body: unknown = null;
    server.use(
      http.post('/api/v1/staff-hr-records', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(hrRecord, { status: 201 });
      }),
    );

    const { result } = renderHookWithProviders(() => useCreateStaffHrRecord(), {
      tenantId: 'tenant-1',
    });
    result.current.mutate({ user_id: 'user-1', department: 'Science' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({ user_id: 'user-1', department: 'Science' });
  });

  it('PATCHes an existing record', async () => {
    let body: unknown = null;
    server.use(
      http.patch('/api/v1/staff-hr-records/hr-1', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...hrRecord, department: 'Math' });
      }),
    );

    const { result } = renderHookWithProviders(() => useUpdateStaffHrRecord('hr-1', 'user-1'), {
      tenantId: 'tenant-1',
    });
    result.current.mutate({ department: 'Math' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({ department: 'Math' });
  });
});

describe('usePromoteStaff', () => {
  it('POSTs the promotion body to :userId/promote', async () => {
    let body: unknown = null;
    server.use(
      http.post('/api/v1/staff-hr-records/user-1/promote', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(historyRow, { status: 201 });
      }),
    );

    const { result } = renderHookWithProviders(() => usePromoteStaff('user-1'), {
      tenantId: 'tenant-1',
    });
    result.current.mutate({ designation_id: 'designation-1', effective_date: '2026-06-01' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({ designation_id: 'designation-1', effective_date: '2026-06-01' });
  });

  it('surfaces a 409 (promotion already in progress) as an error', async () => {
    server.use(
      http.post('/api/v1/staff-hr-records/user-1/promote', () =>
        HttpResponse.json({ statusCode: 409, message: 'in progress' }, { status: 409 }),
      ),
    );

    const { result } = renderHookWithProviders(() => usePromoteStaff('user-1'), {
      tenantId: 'tenant-1',
    });
    result.current.mutate({ designation_id: 'designation-1', effective_date: '2026-06-01' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
