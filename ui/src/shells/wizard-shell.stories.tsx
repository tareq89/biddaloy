import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';

import { rtlDecorator } from '../../.storybook/rtl-decorator';
import { Input } from '../components/input';

import { useWizardShellStep } from './use-wizard-shell-step';
import { WizardShell, type WizardStep } from './wizard-shell';

// No router decorator at the `meta` level — react-router doesn't allow
// nesting `<Router>`s, so a story that needs its own `initialEntries`
// (`DeepLinkedStep`) can't layer a second `MemoryRouter` on top of a
// shared one. Each story that renders `useWizardShellStep` supplies its
// own single `MemoryRouter` instead.
const meta: Meta<typeof WizardShell> = {
  title: 'Shells/WizardShell',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof WizardShell>;

const STEP_IDS = ['amount', 'method', 'review'] as const;

/** Record Payment: irreversible, so `reviewStep` is required by the type
 * system — this story's own render would fail to compile if it were
 * omitted while `irreversible` is `true`. */
function RecordPaymentWizard() {
  const [stepId, setStepId] = useWizardShellStep(STEP_IDS);
  const [amount, setAmount] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const steps: WizardStep[] = [
    {
      id: 'amount',
      label: 'Amount',
      content: (
        <Input
          aria-label="Amount"
          placeholder="0.00"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      ),
      isValid: () => amount.trim() !== '',
    },
    { id: 'method', label: 'Method', content: <p>Choose cash, cheque, or bank transfer.</p> },
  ];

  return (
    <WizardShell
      title="Record payment"
      steps={steps}
      currentStepId={stepId}
      onStepChange={setStepId}
      irreversible
      reviewStep={{
        id: 'review',
        label: 'Review',
        content: <p>Recording a payment of ৳{amount || '0.00'}.</p>,
      }}
      onSubmit={() => setSubmitted(true)}
      result={
        submitted ? (
          <p role="status">
            Payment of ৳{amount} recorded successfully. A receipt has been sent to the
            guardian&rsquo;s registered phone number.
          </p>
        ) : undefined
      }
    />
  );
}

export const Default: Story = {
  decorators: [
    (StoryFn) => (
      <MemoryRouter initialEntries={['/payments/new']}>
        <StoryFn />
      </MemoryRouter>
    ),
  ],
  render: () => <RecordPaymentWizard />,
};

export const DeepLinkedStep: Story = {
  decorators: [
    (StoryFn) => (
      <MemoryRouter initialEntries={['/payments/new?step=method']}>
        <StoryFn />
      </MemoryRouter>
    ),
  ],
  render: () => <RecordPaymentWizard />,
};

/** The first step's `isValid` returns `false` — "Next" stays disabled
 * until the caller's own validation says otherwise, one of this shell's
 * primary behaviors and otherwise only exercised indirectly (by typing a
 * value) in the other stories. */
export const InvalidFirstStep: Story = {
  render: () => (
    <WizardShell
      title="Record payment"
      steps={[
        {
          id: 'amount',
          label: 'Amount',
          content: <p>Enter an amount to continue.</p>,
          isValid: () => false,
        },
        { id: 'method', label: 'Method', content: <p>Choose cash, cheque, or bank transfer.</p> },
      ]}
      currentStepId="amount"
      onStepChange={() => {}}
      onSubmit={() => {}}
    />
  ),
};

/** Stands in for this issue's "result screen with counts and
 * plain-language explanations" acceptance criterion. */
export const ResultScreen: Story = {
  render: () => (
    <WizardShell
      title="Bulk reminders"
      steps={[
        { id: 'confirm', label: 'Confirm', content: <p>Send reminders to 145 guardians?</p> },
      ]}
      currentStepId="confirm"
      onStepChange={() => {}}
      onSubmit={() => {}}
      result={
        <p role="status">
          142 reminders sent successfully. 3 failed because the guardian has no phone number on
          file.
        </p>
      }
    />
  ),
};

export const RightToLeft: Story = {
  render: () => (
    <WizardShell
      title="পেমেন্ট রেকর্ড করুন"
      steps={[{ id: 'amount', label: 'পরিমাণ', content: <p>পরিমাণ লিখুন।</p> }]}
      currentStepId="amount"
      onStepChange={() => {}}
      onSubmit={() => {}}
    />
  ),
  decorators: [rtlDecorator],
};
