import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../test';

import { FilterSheet } from './filter-sheet';

async function renderSheet(props: Partial<React.ComponentProps<typeof FilterSheet>> = {}) {
  const onOpenChange = vi.fn();
  const onClearAll = vi.fn();
  const view = renderWithProviders(
    <FilterSheet
      open
      onOpenChange={onOpenChange}
      title="Filters"
      onClearAll={onClearAll}
      {...props}
    >
      <p>fields</p>
    </FilterSheet>,
    { locale: 'en' },
  );
  await act(async () => {
    await view.localeReady;
  });
  return { ...view, onOpenChange, onClearAll };
}

describe('FilterSheet', () => {
  it('opens as a dialog named by its title with a Close button', async () => {
    await renderSheet();
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('Clear all calls onClearAll', async () => {
    const { onClearAll } = await renderSheet();
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onClearAll).toHaveBeenCalledOnce();
  });

  it('primary button shows the result count and closes the sheet', async () => {
    const { onOpenChange } = await renderSheet({ resultCount: 48 });
    await userEvent.click(screen.getByRole('button', { name: 'Show 48 results' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('primary button says "Show results" without a count', async () => {
    await renderSheet();
    expect(screen.getByRole('button', { name: 'Show results' })).toBeTruthy();
  });

  it('is axe clean', async () => {
    await renderSheet({ resultCount: 3 });
    await expect(document.body).toHaveNoViolations();
  });
});
