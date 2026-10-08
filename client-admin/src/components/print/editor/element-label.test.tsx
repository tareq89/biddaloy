import '@biddaloy/ui/test';

import { useTranslation } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { slotLabel } from './element-label';

function Label({ field }: { field: string }) {
  const { t } = useTranslation('printEditor');
  return <p data-testid="label">{slotLabel(t, field) ?? 'none'}</p>;
}

async function labelFor(field: string, locale: 'en' | 'bn') {
  const { localeReady } = renderWithProviders(<Label field={field} />, { locale });
  await localeReady;
  return screen.findByTestId('label');
}

describe('slotLabel', () => {
  afterEach(cleanupTestState);

  it('names an admit-card sitting slot in English', async () => {
    expect((await labelFor('exam.sitting.3.subject', 'en')).textContent).toBe(
      'Sitting 3 — subject',
    );
  });

  it('names an admit-card sitting slot in Bangla with Bangla digits', async () => {
    expect((await labelFor('exam.sitting.3.room', 'bn')).textContent).toBe('বসা ৩ — কক্ষ');
  });

  it('keeps the ACR criterion labels', async () => {
    expect((await labelFor('acr.criterion.2.score', 'en')).textContent).toBe('Criterion 2 score');
  });

  it('returns undefined for a field that is not a slot', async () => {
    expect((await labelFor('student.name', 'en')).textContent).toBe('none');
  });
});
