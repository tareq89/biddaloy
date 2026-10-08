import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MutationErrorMessage } from './MutationErrorMessage';

function renderMsg(error: unknown) {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <MutationErrorMessage error={error} />,
  });
  return renderWithRouter(root.addChildren([index]), { locale: 'en', tenantId: 'school-1' });
}

afterEach(cleanupTestState);

describe('MutationErrorMessage', () => {
  it('renders the seat-limit message with the numbers from details', async () => {
    const error = Object.assign(new Error('raw'), {
      details: { code: 'SEAT_LIMIT_REACHED', used: 48, limit: 50, requested: 5 },
    });
    renderMsg(error);
    expect(await screen.findByText('Student limit reached')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      'You have 48 of 50 students. 5 more will not fit.',
    );
  });

  it('falls back to the error message otherwise', async () => {
    renderMsg(new Error('boom'));
    expect((await screen.findByRole('alert')).textContent).toBe('boom');
  });
});
