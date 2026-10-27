import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MutationErrorMessage } from './MutationErrorMessage';

function renderMsg(error: unknown, locale: 'en' | 'bn' = 'en') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <MutationErrorMessage error={error} />,
  });
  return renderWithRouter(root.addChildren([index]), { locale, tenantId: 'school-1' });
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

  it('shows a generic sentence, never the server text, for a 500', async () => {
    renderMsg(Object.assign(new Error('Internal thing broke'), { statusCode: 500 }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Something went wrong. Please try again.');
  });

  it('shows the generic sentence for a plain Error', async () => {
    renderMsg(new Error('boom'));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Something went wrong. Please try again.',
    );
  });

  it('maps 409 to the conflict sentence', async () => {
    renderMsg({ statusCode: 409, message: 'duplicate key value' });
    expect((await screen.findByRole('alert')).textContent).toContain('clashes with a record');
  });

  it('maps 403 to the permission sentence', async () => {
    renderMsg({ statusCode: 403, message: 'Forbidden resource' });
    expect((await screen.findByRole('alert')).textContent).toBe(
      "You don't have permission to do that.",
    );
  });

  it('renders Bangla in the bn locale', async () => {
    renderMsg({ statusCode: 500, message: 'x' }, 'bn');
    expect((await screen.findByRole('alert')).textContent).toBe(
      'কিছু একটা ভুল হয়েছে। আবার চেষ্টা করুন।',
    );
  });
});
