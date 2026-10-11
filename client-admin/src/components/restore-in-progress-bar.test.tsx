import '@biddaloy/ui/test';

import { ApiError } from '@biddaloy/ui/api';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { useMutation } from '@tanstack/react-query';
import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { RestoreInProgressBar } from './restore-in-progress-bar';

const MESSAGE = /A backup restore is running/;
const err = (statusCode: number, details?: Record<string, unknown>) =>
  new ApiError({
    statusCode,
    message: 'x',
    timestamp: '',
    path: '/x',
    requestId: 'r',
    ...(details && { details }),
  });

let run: (fail: ApiError | null) => Promise<unknown>;
function Harness() {
  const m = useMutation({
    mutationFn: (fail: ApiError | null) => (fail ? Promise.reject(fail) : Promise.resolve()),
  });
  run = (fail) => m.mutateAsync(fail).catch(() => undefined);
  return <RestoreInProgressBar />;
}
const save = (fail: ApiError | null) => act(async () => void (await run(fail)));

describe('RestoreInProgressBar', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('is hidden at start, shown after a 423, hidden after a later success', async () => {
    renderWithProviders(<Harness />, { locale: 'en', tenantId: 'tenant-1' });
    expect(screen.queryByText(MESSAGE)).toBeNull();
    await save(err(423, { code: 'TENANT_RESTORING' }));
    expect(screen.getByText(MESSAGE)).toBeTruthy();
    await save(null);
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it('ignores errors that are not TENANT_RESTORING', async () => {
    renderWithProviders(<Harness />, { locale: 'en', tenantId: 'tenant-1' });
    await save(err(423, { code: 'OTHER' }));
    await save(err(403));
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });
});
