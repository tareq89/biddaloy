import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { communicationFactory } from '../test/factories';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { useLastReminders, useStudentCommunicationLogs } from './communications';

describe('useStudentCommunicationLogs', () => {
  it("[8.10.2] resolves the Communication tab's message history for one student", async () => {
    server.use(
      http.get('/api/v1/communications/student/:studentId', () =>
        HttpResponse.json([communicationFactory(), communicationFactory()]),
      ),
    );

    const { result } = renderHookWithProviders(() => useStudentCommunicationLogs('student-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
  });

  it('resolves an empty list for a student nothing has ever been sent to', async () => {
    server.use(http.get('/api/v1/communications/student/:studentId', () => HttpResponse.json([])));

    const { result } = renderHookWithProviders(() => useStudentCommunicationLogs('student-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useLastReminders', () => {
  // [8.10.4]'s dues queue "Last reminder" column.
  it('requests a comma-joined student_ids param and resolves a map keyed by student id', async () => {
    let requestedStudentIds: string | null = null;
    server.use(
      http.get('/api/v1/communications/last-reminders', ({ request }) => {
        requestedStudentIds = new URL(request.url).searchParams.get('student_ids');
        return HttpResponse.json([
          { student_id: 'student-1', sent_at: '2026-03-01T00:00:00.000Z', medium: 'SMS' },
        ]);
      }),
    );

    const { result } = renderHookWithProviders(() => useLastReminders(['student-1', 'student-2']), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedStudentIds).toBe('student-1,student-2');
    expect(result.current.data?.get('student-1')?.medium).toBe('SMS');
    expect(result.current.data?.has('student-2')).toBe(false);
  });

  it('does not fire the request for an empty student id list', () => {
    const { result } = renderHookWithProviders(() => useLastReminders([]), {
      tenantId: 'tenant-1',
    });

    expect(result.current.fetchStatus).toBe('idle');
  });
});
