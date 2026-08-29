import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { WizardShell, type WizardStep } from './wizard-shell';

let amountStepMounts = 0;

function AmountStep({ onChange }: { onChange: (value: string) => void }) {
  useEffect(() => {
    amountStepMounts += 1;
  }, []);
  const [value, setValue] = useState('');
  return (
    <input
      aria-label="Amount"
      value={value}
      onChange={(event) => {
        setValue(event.target.value);
        onChange(event.target.value);
      }}
    />
  );
}

function Controlled({ irreversible = false }: { irreversible?: boolean }) {
  const [stepId, setStepId] = useState('amount');
  const [amount, setAmount] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const steps: WizardStep[] = [
    {
      id: 'amount',
      label: 'Amount',
      content: <AmountStep onChange={setAmount} />,
      isValid: () => amount.trim() !== '',
    },
    { id: 'method', label: 'Method', content: <p>Choose a payment method.</p> },
  ];

  const reviewStep: WizardStep = {
    id: 'review',
    label: 'Review',
    content: <p>Review: {amount || 'no amount entered'}</p>,
  };

  const commonProps = {
    title: 'Record payment',
    steps,
    currentStepId: stepId,
    onStepChange: setStepId,
    onSubmit: () => setSubmitted(true),
    result: submitted ? <p role="status">142 payments recorded.</p> : undefined,
  };

  return irreversible ? (
    <WizardShell {...commonProps} irreversible reviewStep={reviewStep} />
  ) : (
    <WizardShell {...commonProps} />
  );
}

describe('WizardShell', () => {
  it('renders the title and the first step by default', () => {
    render(<Controlled />);
    expect(screen.getByRole('heading', { name: 'Record payment' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Amount' })).toBeTruthy();
  });

  it('marks the current step with aria-current="step"', () => {
    render(<Controlled />);
    const amountItem = screen.getByText('Amount').closest('li');
    expect(amountItem?.getAttribute('aria-current')).toBe('step');
  });

  it('blocks forward navigation until the current step validates', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true);

    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '500');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(false),
    );
  });

  it('advances to the next step once valid, and Back returns to the previous one', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '500');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(screen.getByText('Choose a payment method.')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Amount' })).toBeTruthy());
  });

  it('Back preserves previously entered data — the step is cached, not remounted', async () => {
    amountStepMounts = 0;
    const user = userEvent.setup();
    render(<Controlled />);
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '500');
    expect(amountStepMounts).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('Choose a payment method.')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Amount' })).toBeTruthy());

    expect(amountStepMounts).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- tsc disagrees with eslint's type resolution here; the cast is required for `.value` to typecheck under `tsc --noEmit`.
    expect((screen.getByRole('textbox', { name: 'Amount' }) as HTMLInputElement).value).toBe('500');
  });

  it('completing a previously visited step is reachable by clicking it in the step list', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '500');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('Choose a payment method.')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Amount' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Amount' })).toBeTruthy());
  });

  it('a reversible wizard has no review step and Submit appears after the last regular step', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '500');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeTruthy());
    expect(screen.queryByText('Review')).toBeNull();
  });

  it('an irreversible wizard inserts the review step after the regular steps, before Submit', async () => {
    const user = userEvent.setup();
    render(<Controlled irreversible />);
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '500');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('Review: 500')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Submit' })).toBeTruthy();
  });

  it('announces progress on step change via a polite live region', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    expect(screen.getByText('Step 1 of 2: Amount')).toBeTruthy();

    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '500');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('Step 2 of 2: Method')).toBeTruthy());
  });

  it('replaces the entire step flow with the result screen once submission completes', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '500');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    // Scoped to the status region — see payments.test.tsx for the rationale.
    await within(await screen.findByRole('status')).findByText('142 payments recorded.');
    expect(screen.queryByRole('textbox', { name: 'Amount' })).toBeNull();
  });

  it('is axe clean', async () => {
    const { container } = render(<Controlled />);
    await expect(container).toHaveNoViolations();
  });

  it('shows a loading state on Submit while submitting', () => {
    render(
      <WizardShell
        title="Generate fees"
        steps={[{ id: 'confirm', label: 'Confirm', content: <p>Confirm generation.</p> }]}
        currentStepId="confirm"
        onStepChange={vi.fn()}
        onSubmit={vi.fn()}
        submitting
        submitLabel="Generate"
      />,
    );
    expect(screen.getByRole('button', { name: /Generate/ }).getAttribute('aria-busy')).toBe('true');
  });
});
