import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { IosInstallSheet } from './ios-install-sheet';

describe('IosInstallSheet', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('names the app SchoolManager in Bangla, not the old name', async () => {
    const { localeReady } = renderWithProviders(
      <IosInstallSheet open onOpenChange={() => undefined} />,
      { locale: 'bn' },
    );
    await localeReady;

    const description = await screen.findByText(/SchoolManager/);
    expect(description.textContent).not.toContain('বিদ্যালয়');
  });
});
