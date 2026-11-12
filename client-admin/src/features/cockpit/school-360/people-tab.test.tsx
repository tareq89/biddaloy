import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PeopleTab } from './people-tab';

const view = (props: Partial<React.ComponentProps<typeof PeopleTab>> = {}) =>
  renderWithProviders(
    <PeopleTab schoolId="s-1" {...props}>
      <div data-testid="admins-card" />
    </PeopleTab>,
    { locale: 'en', role: 'SUPER_ADMIN', tenantId: 'platform' },
  );

describe('PeopleTab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the admins card first and the counts per role', async () => {
    view();
    expect(await screen.findByTestId('admins-card')).toBeTruthy();
    expect(await screen.findByText(/Teacher: /)).toBeTruthy();
  });

  it('shows the empty message', async () => {
    server.use(
      http.get('*/platform/schools/:id/overview', () =>
        HttpResponse.json({ schoolId: 's-1', peopleByRole: [] }),
      ),
    );
    view();
    expect(await screen.findByText('No people yet.')).toBeTruthy();
  });

  it('shows an error', async () => {
    server.use(
      http.get('*/platform/schools/:id/overview', () => HttpResponse.json({}, { status: 500 })),
    );
    view();
    expect(await screen.findByText('Could not load the people counts.')).toBeTruthy();
  });

  it('calls Login as', async () => {
    const onLoginAs = vi.fn();
    view({ onLoginAs });
    await userEvent.click(await screen.findByRole('button', { name: 'Login as' }));
    expect(onLoginAs).toHaveBeenCalled();
  });
});
