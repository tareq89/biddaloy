import { ApiError } from '@biddaloy/ui/api';
import { i18n } from '@biddaloy/ui/i18n';
import { cleanupTestState } from '@biddaloy/ui/test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PortalQueryError } from './-portal-query-error';

const apiError = (statusCode: number) =>
  new ApiError({ statusCode, message: 'x', requestId: 'r', path: '/p', timestamp: 't' });

describe('PortalQueryError', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the denied state, no retry, on a 403', () => {
    render(
      <PortalQueryError
        error={apiError(403)}
        message="Could not load."
        retryLabel="Try again"
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText("You don't have access to this page.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('shows one sentence and one retry on any other failure', async () => {
    const onRetry = vi.fn();
    render(
      <PortalQueryError
        error={apiError(500)}
        message="Could not load."
        retryLabel="Try again"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('Could not load.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
