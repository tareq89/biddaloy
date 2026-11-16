import { setActiveTenant } from '@biddaloy/ui/api';
import { useCreateAdmissionRound } from '@biddaloy/ui/hooks';
import { cleanupTestState, server } from '@biddaloy/ui/test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useCreateApplicantStaff } from './useCreateApplicantStaff';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

type Mutator = { mutateAsync: (input: never) => Promise<unknown> };
const keys: (string | null)[] = [];
let fail = true;

// Rule 25: create routes carry an Idempotency-Key, a failed attempt resends the
// same key, and a success starts a fresh one.
describe.each([
  [
    'useCreateAdmissionRound',
    () => useCreateAdmissionRound() as unknown as Mutator,
    { name: 'Class 6 admission' } as never,
  ],
  [
    'useCreateApplicantStaff',
    () => useCreateApplicantStaff() as unknown as Mutator,
    {
      intake_id: 'i1',
      applicant_name: 'Rahim',
      date_of_birth: '2015-01-01',
      gender: 'MALE',
      guardian_name: 'Karim',
      guardian_phone: '01712345678',
      extra_fields: {},
      documents: {},
    } as never,
  ],
] as const)('%s', (_name, useHook, input) => {
  beforeEach(() => {
    setActiveTenant('tenant-1');
    keys.length = 0;
    fail = true;
    server.use(
      http.post(/\/api\/v1\/admission(-intakes|\/applicants)$/, ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        if (fail) {
          fail = false;
          return HttpResponse.json({ message: 'boom' }, { status: 500 });
        }
        return HttpResponse.json({ id: 'x', reference_number: 'R1', status: 'PENDING' });
      }),
    );
  });
  afterEach(async () => {
    await cleanupTestState();
  });

  it('sends an Idempotency-Key, repeats it after a failure, rotates after success', async () => {
    const { result } = renderHook(useHook, { wrapper });

    await act(async () => {
      await result.current.mutateAsync(input).catch(() => undefined);
    });
    const first = keys[0];
    expect(first).toBeTruthy();

    await act(async () => {
      await result.current.mutateAsync(input);
    });
    expect(keys[1]).toBe(first);

    await act(async () => {
      await result.current.mutateAsync(input);
    });
    await waitFor(() => expect(keys).toHaveLength(3));
    expect(keys[2]).not.toBe(first);
  });
});
