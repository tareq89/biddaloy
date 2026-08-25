import { File as NodeFile } from 'node:buffer';

import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { createTestQueryClient } from '../test/render-with-providers';

import { useBulkUploadStudents } from './bulk-upload';
import { studentKeys } from './students';

function makeCsvFile(name = 'students.csv'): File {
  // node:buffer's File, not jsdom's: jsdom 30's Blob hangs MSW's XHR
  // body serialization (the request never resolves), while Node's own
  // File streams fine through the interceptor.
  return new NodeFile(['student_name,class\nRahim,Class 5'], name, {
    type: 'text/csv',
  }) as unknown as File;
}

describe('useBulkUploadStudents', () => {
  it('posts the file under the multipart field name `file` and returns the result', async () => {
    // Field name matters: multer's FileInterceptor('file') silently ignores
    // any other name and the server answers 400 "No file uploaded".
    //
    // Asserted by spying on FormData rather than by parsing the request body
    // in the handler: MSW's XHR interceptor does not serialize jsdom
    // FormData under Node 24 (it sends the string "[object FormData]"), so a
    // `request.formData()` assertion tests the harness, not our hook. A real
    // browser XHR sends the multipart body correctly.
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
      http.post('/api/v1/students/bulk-upload', () => {
        requestReceived = true;
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

    const { result } = renderHookWithProviders(() => useBulkUploadStudents(), {
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    const file = makeCsvFile();
    await act(async () => {
      const res = await result.current.mutateAsync({ file });
      expect(res.success_count).toBe(1);
    });

    expect(requestReceived).toBe(true);
    expect(appended).toEqual([['file', file]]);
    appendSpy.mockRestore();
  });

  it('invalidates the students list branch after a partial success (some rows created)', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(studentKeys.list({}), { data: [], total: 0 });
    server.use(
      http.post('/api/v1/students/bulk-upload', () =>
        HttpResponse.json(
          {
            total_rows: 2,
            success_count: 1,
            error_count: 1,
            created_student_ids: ['s-1'],
            errors: [{ row: 3, field: 'roll', value: '5', reason: 'Duplicate roll number 5' }],
          },
          { status: 201 },
        ),
      ),
    );

    const { result } = renderHookWithProviders(() => useBulkUploadStudents(), {
      queryClient,
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    await act(async () => {
      await result.current.mutateAsync({ file: makeCsvFile() });
    });
    await waitFor(() => {
      const state = queryClient.getQueryState(studentKeys.list({}));
      expect(state?.isInvalidated).toBe(true);
    });
  });

  it('surfaces a whole-request 400 as an error without retrying', async () => {
    let requestCount = 0;
    server.use(
      http.post('/api/v1/students/bulk-upload', () => {
        requestCount += 1;
        return HttpResponse.json(
          apiErrorBody(400, 'Missing required columns: roll', '/api/v1/students/bulk-upload'),
          { status: 400 },
        );
      }),
    );

    const { result } = renderHookWithProviders(() => useBulkUploadStudents(), {
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
