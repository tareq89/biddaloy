import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { useSendBulkReminder } from './reminders';

describe('useSendBulkReminder posts the batch and surfaces the server response', () => {
  it('resolves with the batch summary on success', async () => {
    server.use(
      http.post('/api/v1/communications/reminder/bulk', async ({ request }) => {
        const body = (await request.json()) as { student_ids: string[]; message_template: string };
        return HttpResponse.json(
          {
            id: 'batch-1',
            batch_name: 'Manual batch',
            status: 'COMPLETED',
            total_recipients: body.student_ids.length,
            successful_count: body.student_ids.length,
            failed_count: 0,
            message_template: body.message_template,
            created_at: new Date().toISOString(),
            skipped: [],
          },
          { status: 201 },
        );
      }),
    );

    const { result } = renderHookWithProviders(() => useSendBulkReminder(), {
      tenantId: 'tenant-1',
    });

    result.current.mutate({
      student_ids: ['student-1', 'student-2'],
      message_template: 'Dear {{guardian_name}}, a reminder.',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total_recipients).toBe(2);
    expect(result.current.data?.successful_count).toBe(2);
  });

  it('surfaces a server error via isError, not a thrown exception', async () => {
    server.use(
      http.post('/api/v1/communications/reminder/bulk', () =>
        HttpResponse.json(
          apiErrorBody(400, 'Invalid template', '/api/v1/communications/reminder/bulk'),
          {
            status: 400,
          },
        ),
      ),
    );

    const { result } = renderHookWithProviders(() => useSendBulkReminder(), {
      tenantId: 'tenant-1',
    });

    result.current.mutate({ student_ids: ['student-1'], message_template: '' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
