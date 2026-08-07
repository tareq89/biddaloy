import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';

import { rtlDecorator } from '../../.storybook/rtl-decorator';
import { Input } from '../components/input';

import { useWizardShellStep } from './use-wizard-shell-step';
import { WizardShell, type WizardStep } from './wizard-shell';

const meta: Meta<typeof WizardShell> = {
  title: 'Shells/WizardShell',
  tags: ['autodocs'],
  decorators: [
    (StoryFn) => (
      <MemoryRouter initialEntries={['/payments/new']}>
        <StoryFn />
      </MemoryRouter>
    ),
  ],
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
