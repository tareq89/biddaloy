import { createRootRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from '../test/render-with-router';

import { NextActionCard } from './next-action-card';

const renderRouted = (ui: React.ReactElement) =>
  renderWithRouter(createRootRoute({ component: () => ui }));

describe('NextActionCard', () => {
  it('is a named region; Tab reaches the primary then the secondary, Space fires', async () => {
    const onClick = vi.fn();
    const onSecondary = vi.fn();
    renderRouted(
      <NextActionCard
        title="Publish"
        description="Do it."
        action={{ label: 'Go', onClick }}
        secondary={{ label: 'Later', onClick: onSecondary }}
      />,
    );
    expect(await screen.findByRole('region', { name: 'Publish' })).toBeTruthy();
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Go' }));
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(1);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Later' }));
    await user.keyboard(' ');
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  it('done: no button, and the done label is in the name', async () => {
    renderRouted(
      <NextActionCard
        title="Publish"
        description="Done it."
        action={{ label: 'Go' }}
        done
        doneLabel="Done"
      />,
    );
    expect(await screen.findByRole('region', { name: /Publish.*Done/ })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
