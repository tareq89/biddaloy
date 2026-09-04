import { ReminderBatchStatus } from '@biddaloy/shared';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  useReminderBatches,
  useSendBulkReminder,
  useSendSingleReminder,
  useSingleReminderPreview,
} from './reminders';

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

describe('useSingleReminderPreview posts to the preview route and sends nothing', () => {
  it('resolves with recipients and skipped guardians', async () => {
    server.use(
      http.post(
        '/api/v1/communications/reminder/single/:studentId/preview',
        async ({ params, request }) => {
          const body = (await request.json()) as { message_template: string };
          return HttpResponse.json({
            student_id: params.studentId as string,
            recipients: [
              {
                guardian_id: 'guardian-1',
                guardian_name: 'Rahima Begum',
                medium: 'SMS',
                address: '+8801700000000',
                // The server renders placeholders; echoing the template here
                // proves the hook passes it through untouched.
                message_body: body.message_template,
                subject: null,
              },
            ],
            skipped: [
              { guardian_id: 'guardian-2', guardian_name: 'Karim Uddin', reason: 'no_guardians' },
            ],
          });
        },
      ),
    );

    const { result } = renderHookWithProviders(() => useSingleReminderPreview(), {
      tenantId: 'tenant-1',
    });

    result.current.mutate({
      studentId: 'student-1',
      input: { message_template: 'Dear {{guardian_name}}' },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.recipients[0]?.guardian_name).toBe('Rahima Begum');
    expect(result.current.data?.skipped[0]?.reason).toBe('no_guardians');
  });

  it('surfaces a 400 (unsupported placeholder) via isError', async () => {
    server.use(
      http.post('/api/v1/communications/reminder/single/:studentId/preview', () =>
        HttpResponse.json(
          apiErrorBody(
            400,
            'Unsupported template placeholder(s): {{class_name}}',
            '/api/v1/communications/reminder/single/student-1/preview',
          ),
          { status: 400 },
        ),
      ),
    );

    const { result } = renderHookWithProviders(() => useSingleReminderPreview(), {
      tenantId: 'tenant-1',
    });

    result.current.mutate({
      studentId: 'student-1',
      input: { message_template: 'Dear {{class_name}}' },
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useSendSingleReminder posts to the send route', () => {
  it('resolves with sent and skipped recipients', async () => {
    server.use(
      http.post('/api/v1/communications/reminder/single/:studentId', ({ params }) =>
        HttpResponse.json(
          {
            student_id: params.studentId as string,
            sent: [
              {
                communication_log_id: 'log-1',
                guardian_id: 'guardian-1',
                guardian_name: 'Rahima Begum',
                medium: 'SMS',
                status: 'QUEUED',
              },
            ],
            skipped: [],
          },
          { status: 201 },
        ),
      ),
    );

    const { result } = renderHookWithProviders(() => useSendSingleReminder(), {
      tenantId: 'tenant-1',
    });

    result.current.mutate({
      studentId: 'student-1',
      input: { message_template: 'Dear {{guardian_name}}' },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.sent[0]?.status).toBe('QUEUED');
  });
});

// [8.14.10]: `search`/`status`/`from_date`/`to_date`/`sort`/`order` mirror
// `QueryReminderBatchesDto`, landed server-side by #373 but never threaded
// through `ReminderBatchListFilters` until now.
describe('useReminderBatches requests every QueryReminderBatchesDto field', () => {
  it('sends search, status, from_date, to_date, sort, and order as query params', async () => {
    const requested = new URLSearchParams();
    server.use(
      http.get('/api/v1/communications/reminder/bulk', ({ request }) => {
        for (const [key, value] of new URL(request.url).searchParams) requested.set(key, value);
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
      }),
    );

    const { result } = renderHookWithProviders(
      () =>
        useReminderBatches({
          search: 'Winter fee',
          status: ReminderBatchStatus.COMPLETED,
          from_date: '2026-01-01',
          to_date: '2026-01-31',
          sort: 'batch_name',
          order: 'asc',
        }),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requested.get('search')).toBe('Winter fee');
    expect(requested.get('status')).toBe('COMPLETED');
    expect(requested.get('from_date')).toBe('2026-01-01');
    expect(requested.get('to_date')).toBe('2026-01-31');
    expect(requested.get('sort')).toBe('batch_name');
    expect(requested.get('order')).toBe('asc');
  });
});
