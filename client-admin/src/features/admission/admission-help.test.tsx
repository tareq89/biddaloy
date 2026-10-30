import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, it, vi } from 'vitest';

import { expectHelp, withHelp } from '../../help/test-utils';

import { EvaluateApplicantForm } from './EvaluateApplicantForm';
import { EMPTY_INTAKE_FORM, IntakeForm } from './IntakeForm';

afterEach(async () => {
  await cleanupTestState();
});

describe('admission (?) hints [#3293]', () => {
  it('shows the intake dates (?)', async () => {
    const { localeReady } = renderWithProviders(
      withHelp(<IntakeForm value={EMPTY_INTAKE_FORM} onChange={vi.fn()} />),
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;
    await screen.findByLabelText(/title/i);
    await expectHelp('people.admissionIntakes.field.dates');
  });

  it('shows the evaluation notes (?)', async () => {
    const { localeReady } = renderWithProviders(
      withHelp(<EvaluateApplicantForm applicantId="a-1" open onOpenChange={vi.fn()} />),
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;
    await screen.findByRole('dialog');
    await expectHelp('people.admissionApplicants.field.notes');
  });
});
