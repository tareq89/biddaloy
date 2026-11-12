import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuditFilters } from './-audit-filters';

afterEach(async () => {
  await cleanupTestState();
});

describe('AuditFilters', () => {
  it('picking an action reports only that key', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(<AuditFilters value={{}} onChange={onChange} />, {
      locale: 'en',
    });
    await localeReady;
    await user.click(await screen.findByRole('combobox', { name: 'Action' }));
    await user.click(await screen.findByRole('option', { name: 'Login as started' }));
    expect(onChange).toHaveBeenCalledWith({ action: 'IMPERSONATION_STARTED' });
  });

  it('shows Remove and Clear all only when something is set', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { localeReady, rerender } = renderWithProviders(
      <AuditFilters value={{}} onChange={onChange} />,
      { locale: 'en' },
    );
    await localeReady;
    expect(screen.queryByRole('button', { name: 'Clear all filters' })).toBeNull();
    rerender(<AuditFilters value={{ sessionId: 'v1' }} onChange={onChange} />);
    await user.click(await screen.findByRole('button', { name: /Remove this filter/ }));
    expect(onChange).toHaveBeenCalledWith({ sessionId: undefined });
    await user.click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenantId: undefined, sessionId: undefined, from: undefined }),
    );
  });
});
