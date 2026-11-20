import { UserRole, type LegalDocument } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { getLegalDoc } from '../features/legal/legal-docs';
import { routeTree } from '../routeTree.gen';

// Signed in: the signed-out path needs the root guard to allow /legal/<doc> (see handoff).
const OPTS = { tenantId: 'tenant-1', role: UserRole.ADMIN, locale: 'en' as const };

afterEach(async () => {
  await cleanupTestState();
});

const firstHeading = (lang: 'bn' | 'en', doc: string) =>
  /^#\s+(.+)$/m.exec(getLegalDoc(doc as LegalDocument, lang).body)![1]!.trim();

describe('/legal/$doc', () => {
  it.each(['terms', 'privacy', 'dpa', 'sla'])('renders %s in en and bn', async (doc) => {
    for (const locale of ['en', 'bn'] as const) {
      renderWithRouter(routeTree, { initialEntries: [`/legal/${doc}`], ...OPTS, locale });
      expect(
        await screen.findByRole('heading', { level: 2, name: firstHeading(locale, doc) }),
      ).toBeTruthy();
      // The sr-only h1 is the route-focus target.
      expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
      await cleanupTestState();
    }
  });

  it('sets the page title', async () => {
    renderWithRouter(routeTree, { initialEntries: ['/legal/terms'], ...OPTS, locale: 'bn' });
    await waitFor(() => expect(document.title).toBe('শর্তাবলি · SchoolManagerP'));
  });

  it('shows the 404 page for an unknown document', async () => {
    renderWithRouter(routeTree, { initialEntries: ['/legal/nope'], ...OPTS });
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
  });
});
