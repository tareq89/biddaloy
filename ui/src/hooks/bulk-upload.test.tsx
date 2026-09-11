import { File as NodeFile } from 'node:buffer';

import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { createTestQueryClient } from '../test/render-with-providers';

import { useValidateStudentUpload, useCommitStudentUpload } from './bulk-upload';
import { studentKeys } from './students';

function makeCsvFile(name = 'students.csv'): File {
  // node:buffer's File, not jsdom's: jsdom 30's Blob hangs MSW's XHR
  // body serialization (the request never resolves), while Node's own
  // File streams fine through the interceptor.
  return new NodeFile(['student_name,class\nRahim,Class 5'], name, {
    type: 'text/csv',
  }) as unknown as File;
}

describe('useValidateStudentUpload', () => {
  it('posts the file under the multipart field name `file` and returns a PreviewResult', async () => {
    const appended: [string, unknown][] = [];
    const appendSpy = vi.spyOn(FormData.prototype, 'append').mockImplementation(function (
      this: FormData,
      name: string,
      value: unknown,
    ) {
      appended.push([name, value]);
    });

    let requestReceived = false;
    server.use(
      http.post('/api/v1/students/bulk-upload/validate', () => {
        requestReceived = true;
        return HttpResponse.json(
          {
            staging_id: 'stage-1',
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            rows_to_create: 1,
            preview: [
              {
                row: 2,
                student_name: 'Rahim',
                class: 'Class 5',
                section: 'A',
                guardian1_phone: '+8801711111111',
              },
            ],
            errors: [],
            hard_error_count: 0,
          },
          { status: 201 },
        );
      }),
    );

    const { result } = renderHookWithProviders(() => useValidateStudentUpload(), {
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    const file = makeCsvFile();
    await act(async () => {
      const res = await result.current.mutateAsync({ file });
      expect(res.staging_id).toBe('stage-1');
      expect(res.summary.rows_to_create).toBe(1);
      expect(res.hard_error_count).toBe(0);
    });

    expect(requestReceived).toBe(true);
    expect(appended).toEqual([['file', file]]);
    appendSpy.mockRestore();
  });

  it('maps validate-time row errors into the shared preview error shape', async () => {
    server.use(
      http.post('/api/v1/students/bulk-upload/validate', () =>
        HttpResponse.json(
          {
            staging_id: 'stage-2',
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            rows_to_create: 0,
            preview: [],
            errors: [
              { row: 3, field: 'guardian1_phone', value: 'bad', reason: 'Invalid phone format' },
            ],
            hard_error_count: 1,
          },
          { status: 201 },
        ),
      ),
    );

    const { result } = renderHookWithProviders(() => useValidateStudentUpload(), {
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    await act(async () => {
      const res = await result.current.mutateAsync({ file: makeCsvFile() });
      expect(res.errors).toEqual([
        {
          row: 3,
          column: 'guardian1_phone',
          message: 'Invalid phone format',
          value: 'bad',
          severity: 'error',
        },
      ]);
      expect(res.hard_error_count).toBe(1);
    });
  });

  it('surfaces a whole-request 400 as an error without retrying', async () => {
    let requestCount = 0;
    server.use(
      http.post('/api/v1/students/bulk-upload/validate', () => {
        requestCount += 1;
        return HttpResponse.json(
          apiErrorBody(
            400,
            'Missing required columns: roll',
            '/api/v1/students/bulk-upload/validate',
          ),
          { status: 400 },
        );
      }),
    );

    const { result } = renderHookWithProviders(() => useValidateStudentUpload(), {
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    act(() => {
      result.current.mutate({ file: makeCsvFile() });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(requestCount).toBe(1);
  });
});

describe('useCommitStudentUpload', () => {
  it('posts the staging_id and returns the commit result', async () => {
    let receivedBody: unknown;
    server.use(
      http.post('/api/v1/students/bulk-upload/commit', async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(
          {
            total_rows: 1,
            success_count: 1,
            error_count: 0,
            created_student_ids: ['s-1'],
            errors: [],
          },
          { status: 201 },
        );
      }),
    );

    const { result } = renderHookWithProviders(() => useCommitStudentUpload(), {
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    await act(async () => {
      const res = await result.current.mutateAsync('stage-1');
      expect(res.success_count).toBe(1);
    });
    expect(receivedBody).toEqual({ staging_id: 'stage-1' });
  });

  it('invalidates the students list branch after a successful commit', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(studentKeys.list({}), { data: [], total: 0 });
    server.use(
      http.post('/api/v1/students/bulk-upload/commit', () =>
        HttpResponse.json(
          {
            total_rows: 1,
            success_count: 1,
            error_count: 0,
            created_student_ids: ['s-1'],
            errors: [],
          },
          { status: 201 },
        ),
      ),
    );

    const { result } = renderHookWithProviders(() => useCommitStudentUpload(), {
      queryClient,
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    await act(async () => {
      await result.current.mutateAsync('stage-1');
    });
    await waitFor(() => {
      const state = queryClient.getQueryState(studentKeys.list({}));
      expect(state?.isInvalidated).toBe(true);
    });
  });

  it('normalises a 404 (expired/consumed staging_id) to a status-bearing error', async () => {
    server.use(
      http.post('/api/v1/students/bulk-upload/commit', () =>
        HttpResponse.json(
          apiErrorBody(
            404,
            'No staged upload found for this id.',
            '/api/v1/students/bulk-upload/commit',
          ),
          { status: 404 },
        ),
      ),
    );

    const { result } = renderHookWithProviders(() => useCommitStudentUpload(), {
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync('stage-missing');
      } catch (error) {
        caught = error;
      }
    });
    expect((caught as { status?: number }).status).toBe(404);
  });
});
