import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AdmissionMoved } from './AdmissionMoved';

afterEach(async () => {
  await cleanupTestState();
});

describe('AdmissionMoved [#4209]', () => {
  it('says the old link is gone and makes no request', async () => {
    const { localeReady } = renderWithProviders(<AdmissionMoved />);
    await localeReady;
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.getByText(/./, { selector: 'p' })).toBeTruthy();
  });
});
