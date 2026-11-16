import { ApiError } from '@biddaloy/ui/api';
import { i18n } from '@biddaloy/ui/i18n';
import { cleanupTestState } from '@biddaloy/ui/test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QueryFailed } from './-query-failed';

const apiError = (statusCode: number) =>
  new ApiError({
    statusCode,
    message: 'secret server text',
    timestamp: '',
    path: '',
    requestId: '',
  });

describe('QueryFailed', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });
  afterEach(async () => {
    await cleanupTestState();
  });

  it('403 shows the access-denied card, not a Retry', async () => {
    render(<QueryFailed error={apiError(403)} message="Could not load." onRetry={vi.fn()} />);
    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: /retry|try again/i })).toBeNull();
  });

  it('other faults show the fixed sentence and one Retry, never the server text', async () => {
    const onRetry = vi.fn();
    render(<QueryFailed error={apiError(500)} message="Could not load." onRetry={onRetry} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load.');
    expect(screen.queryByText(/secret server text/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
