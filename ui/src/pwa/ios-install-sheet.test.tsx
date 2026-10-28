import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { HelpProvider } from '../components/help-hint';
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

  it('helpId draws a (?) beside the title; the dialog keeps its name', async () => {
    const index = {
      install: {
        title: { bn: 'ফোনে খোলা', en: 'Installing the app' },
        summary: { bn: 's', en: 's' },
        path: 'start/phone',
        anchor: 'task-main',
        knownIssues: 0,
      },
    };
    const { localeReady } = renderWithProviders(
      <HelpProvider index={index} lang="en" baseUrl="https://g.test">
        <IosInstallSheet open onOpenChange={() => undefined} helpId="install" />
      </HelpProvider>,
      { locale: 'en' },
    );
    await localeReady;
    expect(await screen.findByRole('button', { name: 'Help: Installing the app' })).toBeTruthy();
    expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBeTruthy();
  });
});
