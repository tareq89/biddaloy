import '@biddaloy/ui/test';

import type { PrintSuggestion } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NewTemplateDialog } from './new-template-dialog';

const suggestions: PrintSuggestion[] = [
  {
    key: 'student-portrait-classic',
    documentKind: 'STUDENT_ID_CARD',
    orientation: 'portrait',
    style: 'classic',
    nameKey: 'a',
  },
  {
    key: 'student-landscape-modern',
    documentKind: 'STUDENT_ID_CARD',
    orientation: 'landscape',
    style: 'modern',
    nameKey: 'b',
  },
  {
    key: 'acr-a4-standard',
    documentKind: 'ACR_ASSESSMENT',
    orientation: 'portrait',
    style: 'classic',
    nameKey: 'd',
  },
  {
    key: 'staff-portrait-classic',
    documentKind: 'STAFF_ID_CARD',
    orientation: 'portrait',
    style: 'classic',
    nameKey: 'c',
  },
];

function serve() {
  server.use(
    http.get('/api/v1/print-templates/suggestions', () => HttpResponse.json(suggestions)),
    http.get('/api/v1/print-templates/suggestions/:key/artwork/:side', () =>
      HttpResponse.text('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', {
        headers: { 'Content-Type': 'image/svg+xml' },
      }),
    ),
  );
}

function setup(props: { initialSuggestionKey?: string } = {}) {
  const onCreated = vi.fn();
  const onOpenChange = vi.fn();
  const view = renderWithProviders(
    <NewTemplateDialog open onOpenChange={onOpenChange} onCreated={onCreated} {...props} />,
    { locale: 'en', role: 'ADMIN', tenantId: 'school-1' },
  );
  return { ...view, onCreated, onOpenChange };
}

describe('NewTemplateDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('kind -> design -> name -> create sends the design key, then opens the new template', async () => {
    serve();
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/print-templates', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 'new-1', name: 'My card' }, { status: 201 });
      }),
    );
    const { user, onCreated } = setup();

    // Only this document type's designs are offered.
    expect(
      await screen.findAllByRole('button', { name: /Classic · portrait|Modern · landscape/ }),
    ).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: /Modern · landscape/ }));

    const name = await screen.findByLabelText<HTMLInputElement>('Name');
    expect(name.value).toBe('Modern landscape ID card'); // the default follows the chosen design
    await user.clear(name);
    await user.type(name, 'My card');
    await user.click(screen.getByRole('button', { name: 'Create and open editor' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new-1'));
    expect(body).toEqual({ name: 'My card', suggestion_key: 'student-landscape-modern' });
  });

  it("switching the document type shows that type's designs and clears the choice", async () => {
    serve();
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: /Classic · portrait/ }));
    expect(await screen.findByLabelText('Name')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Staff ID card' }));

    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Create and open editor' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getAllByRole('button', { name: /Classic · portrait/ })).toHaveLength(1);
  });

  it('labels the ACR design as an A4 page, not "Classic · portrait"', async () => {
    serve();
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: /ACR \(confidential report\)/ }));

    expect(await screen.findByRole('button', { name: /ACR assessment · A4/ })).toBeTruthy();
    expect(screen.getByText('A4 page, front only, up to 30 criteria.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Classic · portrait/ })).toBeNull();
  });

  it('loads thumbnails through the authenticated client as data URLs, never a bare image URL', async () => {
    serve();
    setup();

    const img = (await screen.findAllByRole('img'))[0]!;
    expect(img.getAttribute('src')).toMatch(/^data:/);
  });

  it('cannot create without a name', async () => {
    serve();
    const { user } = setup({ initialSuggestionKey: 'student-portrait-classic' });
    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    expect(
      screen.getByRole('button', { name: 'Create and open editor' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('shows an error and stays open when creating fails', async () => {
    serve();
    server.use(
      http.post('/api/v1/print-templates', () =>
        HttpResponse.json({ message: 'boom' }, { status: 400 }),
      ),
    );
    const { user, onCreated } = setup({ initialSuggestionKey: 'student-portrait-classic' });
    await screen.findByLabelText('Name');

    await user.click(screen.getByRole('button', { name: 'Create and open editor' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
