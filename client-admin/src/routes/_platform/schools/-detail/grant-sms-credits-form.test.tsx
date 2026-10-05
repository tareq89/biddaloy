import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GrantSmsCreditsForm } from './grant-sms-credits-form';

/** The dialog footer owns the submit button; tests stand one in via `form=`. */
function renderForm(
  onSubmit: () => void = () => undefined,
  onFieldsChange: () => void = () => undefined,
) {
  return renderWithProviders(
    <>
      <GrantSmsCreditsForm
        formId="grant-form"
        onFieldsChange={onFieldsChange}
        onSubmit={onSubmit}
      />
      <button type="submit" form="grant-form" data-testid="save" />
    </>,
    { locale: 'en' },
  );
}

describe('GrantSmsCreditsForm', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('rejects zero units with the translated message and a short reason without submitting', async () => {
    const onSubmit = vi.fn();
    const { user } = renderForm(onSubmit);

    await user.type(await screen.findByLabelText('Number of SMS'), '0');
    await user.type(screen.getByLabelText('Reason'), 'no');
    await user.click(screen.getByTestId('save'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText('Enter a number other than zero.')).toBeTruthy();
    expect(screen.getByText('Write the reason in at least 5 characters.')).toBeTruthy();
  });

  it('rejects a decimal with the whole-number message', async () => {
    const onSubmit = vi.fn();
    const { user } = renderForm(onSubmit);

    await user.type(await screen.findByLabelText('Number of SMS'), '1.5');
    await user.type(screen.getByLabelText('Reason'), 'Initial top-up');
    await user.click(screen.getByTestId('save'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText('Enter a whole number.')).toBeTruthy();
  });

  it('submits parsed units and reason once both are valid', async () => {
    const onSubmit = vi.fn();
    const { user } = renderForm(onSubmit);

    await user.type(await screen.findByLabelText('Number of SMS'), '500');
    await user.type(screen.getByLabelText('Reason'), 'Initial top-up');
    await user.click(screen.getByTestId('save'));

    expect(onSubmit).toHaveBeenCalledWith({ units: 500, reason: 'Initial top-up' });
  });

  it('accepts Bangla digits and a negative value', async () => {
    const onSubmit = vi.fn();
    const { user } = renderForm(onSubmit);

    await user.type(await screen.findByLabelText('Number of SMS'), '-৫০');
    await user.type(screen.getByLabelText('Reason'), 'Correcting an over-grant');
    await user.click(screen.getByTestId('save'));

    expect(onSubmit).toHaveBeenCalledWith({ units: -50, reason: 'Correcting an over-grant' });
  });

  it('calls onFieldsChange as the user edits', async () => {
    const onFieldsChange = vi.fn();
    const { user } = renderForm(() => undefined, onFieldsChange);

    await user.type(await screen.findByLabelText('Number of SMS'), '1');
    expect(onFieldsChange).toHaveBeenCalled();
  });
});
