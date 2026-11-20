import { LegalDocument } from '@biddaloy/shared';
import { renderWithProviders } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { LegalDocumentsDialog } from './legal-documents-dialog';

const OPENER = 'read';
const DOCS = [LegalDocument.TERMS, LegalDocument.PRIVACY, LegalDocument.DPA];

function Harness({ onAgree = () => {} }: { onAgree?: () => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>{OPENER}</button>
      <LegalDocumentsDialog open={open} onOpenChange={setOpen} docs={DOCS} onAgree={onAgree} />
    </>
  );
}

describe('LegalDocumentsDialog', () => {
  it('switches tabs and language', async () => {
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(<Harness />, { locale: 'en' });
    await localeReady;
    await user.click(await screen.findByText(OPENER));
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('heading', { name: 'Terms of Service' })).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Privacy policy' }));
    expect(screen.queryByRole('heading', { name: 'Terms of Service' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'বাংলা' }));
    expect(screen.getByRole('tab', { name: 'গোপনীয়তা নীতি' })).toBeTruthy();
  });

  it('Agree calls onAgree without scrolling', async () => {
    const user = userEvent.setup();
    const onAgree = vi.fn();
    const { localeReady } = renderWithProviders(<Harness onAgree={onAgree} />, { locale: 'en' });
    await localeReady;
    await user.click(await screen.findByText(OPENER));
    await user.click(screen.getByRole('button', { name: 'Agree' }));
    expect(onAgree).toHaveBeenCalledOnce();
  });

  it('Esc closes and focus returns to the opener', async () => {
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(<Harness />, { locale: 'en' });
    await localeReady;
    await user.click(await screen.findByText(OPENER));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText(OPENER)));
  });

  it('each tab starts with the three-line summary, in the page language', async () => {
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(<Harness />, { locale: 'en' });
    await localeReady;
    await user.click(await screen.findByText(OPENER));
    for (const [tab, first] of [
      ['Terms', 'The school owns its data. We never sell it.'],
      ['Privacy policy', "We keep data only to run the school's work and keep the service safe."],
      ['Data agreement', 'All student, guardian and staff data belongs to the school.'],
    ] as const) {
      await user.click(screen.getByRole('tab', { name: tab }));
      const panel = screen.getByRole('tabpanel');
      expect(panel.firstElementChild?.tagName).toBe('UL');
      expect(panel.firstElementChild?.children).toHaveLength(3);
      expect(panel.firstElementChild?.firstElementChild?.textContent).toBe(first);
    }
    // The Markdown's own "In short" list is not repeated.
    expect(screen.queryByText('In short')).toBeNull();
  });

  it('switching language translates the dialog strings and summary too', async () => {
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(<Harness />, { locale: 'en' });
    await localeReady;
    await user.click(await screen.findByText(OPENER));
    await user.click(screen.getByRole('button', { name: 'বাংলা' }));
    expect(await screen.findByText('আইনি নথি')).toBeTruthy();
    expect(
      await screen.findByText('আপনার স্কুলের তথ্যের মালিক স্কুল। আমরা তা বিক্রি করি না।'),
    ).toBeTruthy();
  });
});
