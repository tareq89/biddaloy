import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { communicationFactory } from '../test/factories';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { useStudentCommunicationLogs } from './communications';

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
