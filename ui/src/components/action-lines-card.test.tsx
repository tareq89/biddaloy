import { createRootRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from '../test/render-with-router';

import { ActionLinesCard } from './action-lines-card';

function renderRouted(ui: React.ReactElement) {
  return renderWithRouter(createRootRoute({ component: () => ui }));
}

describe('ActionLinesCard', () => {
  it.each(['danger', 'warning', 'neutral'] as const)(
    '%s tone has an icon and text; action fires once',
    async (tone) => {
      const onClick = vi.fn();
      const { container } = renderRouted(
        <ActionLinesCard
          title="To do"
          emptyText="Nothing"
          lines={[{ id: 'a', tone, text: 'Do it', action: { label: 'Go', onClick } }]}
        />,
      );
      const item = await screen.findByText('Do it');
      expect(item.closest('li')?.getAttribute('data-tone')).toBe(tone);
      expect(item.closest('li')?.querySelector('svg')).not.toBeNull();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Go' }));
      expect(onClick).toHaveBeenCalledTimes(1);
      await expect(container).toHaveNoViolations();
    },
  );

  it('keeps the given order and renders href as a link', async () => {
    const { container } = renderRouted(
      <ActionLinesCard
        title="To do"
        emptyText="Nothing"
        lines={[
          { id: 'b', tone: 'warning', text: 'First', action: { label: 'A', href: '/x' } },
          { id: 'a', tone: 'danger', text: 'Second', action: { label: 'B', onClick: () => {} } },
        ]}
      />,
    );
    const items = await screen.findAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual(['FirstA', 'SecondB']);
    expect(screen.getByRole('link', { name: 'A' }).getAttribute('href')).toBe('/x');
    await expect(container).toHaveNoViolations();
  });

  it('shows emptyText with no lines', async () => {
    const { container } = renderRouted(
      <ActionLinesCard title="To do" emptyText="Nothing" lines={[]} />,
    );
    expect(await screen.findByText('Nothing')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
    await expect(container).toHaveNoViolations();
  });
});
