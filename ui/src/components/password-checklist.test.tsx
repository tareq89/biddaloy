import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { ApiError } from '../api';
import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { PasswordChecklist, weakPasswordRules } from './password-checklist';

afterEach(async () => {
  await cleanupTestState();
});

function Harness() {
  const [value, setValue] = React.useState('');
  return (
    <>
      <input aria-label="pw" value={value} onChange={(e) => setValue(e.target.value)} />
      <PasswordChecklist password={value} />
    </>
  );
}

describe('PasswordChecklist', () => {
  it('lists five rules for staff and two for family', async () => {
    const { unmount } = renderWithProviders(<PasswordChecklist password="" />, { locale: 'en' });
    expect(await screen.findAllByRole('listitem')).toHaveLength(5);
    unmount();
    renderWithProviders(<PasswordChecklist password="" audience="family" />, { locale: 'en' });
    expect(await screen.findAllByRole('listitem')).toHaveLength(2);
  });

  it('shows the staff rules when the server failed a rule the family list does not have', async () => {
    renderWithProviders(
      <PasswordChecklist password="abcdefg1" audience="family" failed={['upper', 'special']} />,
      { locale: 'en' },
    );
    expect(await screen.findAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByRole('list')).toBeTruthy();
  });

  it('flips rows as the user types, with text (not colour) saying so', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />, { locale: 'en' });

    expect(await screen.findByText('0 of 5 rules met')).toBeTruthy();
    await user.type(screen.getByLabelText('pw'), 'abcdefgh');
    expect(screen.getByText('2 of 5 rules met')).toBeTruthy();

    const items = screen.getAllByRole('listitem');
    expect(items[0]!.textContent).toContain('done');
    expect(items[1]!.textContent).toContain('not done');

    await user.type(screen.getByLabelText('pw'), 'A1!');
    expect(screen.getByText('5 of 5 rules met')).toBeTruthy();
  });

  it('counts Bangla digits as digits', async () => {
    renderWithProviders(<PasswordChecklist password="১২" audience="family" />, { locale: 'en' });
    expect(await screen.findByText('1 of 2 rules met')).toBeTruthy();
  });

  it('forces server-rejected rules to not met, even when the client thinks they pass', async () => {
    renderWithProviders(<PasswordChecklist password="Strong-pass1" failed={['special']} />, {
      locale: 'en',
    });
    expect(await screen.findByText('4 of 5 rules met')).toBeTruthy();
  });

  it('reads failed rules from a PASSWORD_TOO_WEAK ApiError only', () => {
    const weak = new ApiError({
      statusCode: 400,
      message: 'weak',
      details: { code: 'PASSWORD_TOO_WEAK', failed: ['upper'] },
    } as never);
    expect(weakPasswordRules(weak)).toEqual(['upper']);
    expect(weakPasswordRules(new Error('x'))).toBeUndefined();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<PasswordChecklist password="Ab1" />, {
      locale: 'en',
    });
    await screen.findAllByRole('listitem');
    await expect(container).toHaveNoViolations();
  });
});
