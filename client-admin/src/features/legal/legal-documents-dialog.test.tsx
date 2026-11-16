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
    await user.click(screen.getByText(OPENER));
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('heading', { name: 'Terms of Service' })).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Privacy' }));
    expect(screen.queryByRole('heading', { name: 'Terms of Service' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'বাংলা' }));
    expect(screen.getByRole('tab', { name: 'গোপনীয়তা নীতি' })).toBeTruthy();
  });

  it('Agree calls onAgree without scrolling', async () => {
    const user = userEvent.setup();
    const onAgree = vi.fn();
    const { localeReady } = renderWithProviders(<Harness onAgree={onAgree} />, { locale: 'en' });
    await localeReady;
    await user.click(screen.getByText(OPENER));
    await user.click(screen.getByRole('button', { name: 'Agree' }));
    expect(onAgree).toHaveBeenCalledOnce();
  });

  it('Esc closes and focus returns to the opener', async () => {
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(<Harness />, { locale: 'en' });
    await localeReady;
    await user.click(screen.getByText(OPENER));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText(OPENER)));
  });
});
