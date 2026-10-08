import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DocumentsSection } from './DocumentsSection';

const SCHOOL_ID = 'school-1';
const opts = { locale: 'en' as const, role: 'ADMIN' as const, tenantId: SCHOOL_ID };
const WITHHOLD = 'Withhold admit cards when fees are due';
const PREFIX = /^School short code/;

function capturePatch() {
  const body = vi.fn();
  server.use(
    http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
      body(await request.json());
      return HttpResponse.json({ version: 1 });
    }),
  );
  return body;
}

describe('DocumentsSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the stored values and an example with the code', async () => {
    renderWithProviders(
      <DocumentsSection
        schoolId={SCHOOL_ID}
        documents={{ withholdAdmitCardForDues: true, serialPrefix: 'DAHS' }}
      />,
      opts,
    );
    expect((await screen.findByLabelText(WITHHOLD)).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText<HTMLInputElement>(PREFIX).value).toBe('DAHS');
    expect(screen.getByText(/Example: DAHS-TC-\d{4}-00007/)).toBeTruthy();
  });

  it('uppercases typing and updates the example; a 1-letter code is rejected without calling the API', async () => {
    const patch = capturePatch();
    const { user } = renderWithProviders(
      <DocumentsSection schoolId={SCHOOL_ID} documents={undefined} />,
      opts,
    );
    const input = await screen.findByLabelText<HTMLInputElement>(PREFIX);
    await user.type(input, 'dahs');
    expect(input.value).toBe('DAHS');
    expect(screen.getByText(/Example: DAHS-TC-\d{4}-00007/)).toBeTruthy();

    await user.clear(input);
    await user.type(input, 'd');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Use 2–8 capital letters or digits.')).toBeTruthy();
    expect(patch).not.toHaveBeenCalled();
  });

  it('clearing the code sends serialPrefix: null so the server removes it', async () => {
    const patch = capturePatch();
    const { user } = renderWithProviders(
      <DocumentsSection schoolId={SCHOOL_ID} documents={{ serialPrefix: 'DAHS' }} />,
      opts,
    );
    await user.clear(await screen.findByLabelText(PREFIX));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]![0]).toEqual({
      version: 1,
      documents: { withholdAdmitCardForDues: false, serialPrefix: null },
    });
  });

  it('toggling the checkbox from the keyboard sends withholdAdmitCardForDues: true', async () => {
    const patch = capturePatch();
    const { user } = renderWithProviders(
      <DocumentsSection schoolId={SCHOOL_ID} documents={undefined} />,
      opts,
    );
    (await screen.findByLabelText(WITHHOLD)).focus();
    await user.keyboard(' ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]![0]).toEqual({
      version: 1,
      documents: { withholdAdmitCardForDues: true, serialPrefix: null },
    });
  });

  it('shows a translated error on 403', async () => {
    server.use(
      http.patch('/api/v1/schools/:id/settings', () =>
        HttpResponse.json(
          {
            statusCode: 403,
            message: 'SERVER_SECRET_TEXT',
            timestamp: new Date().toISOString(),
            path: '/x',
            requestId: 'r',
          },
          { status: 403 },
        ),
      ),
    );
    const { user } = renderWithProviders(
      <DocumentsSection schoolId={SCHOOL_ID} documents={undefined} />,
      opts,
    );
    await user.click(await screen.findByLabelText(WITHHOLD));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText("You don't have permission to do this.")).toBeTruthy();
    expect(screen.queryByText('SERVER_SECRET_TEXT')).toBeNull();
  });

  it('has no axe violations', async () => {
    const { container } = renderWithProviders(
      <DocumentsSection schoolId={SCHOOL_ID} documents={{ serialPrefix: 'DAHS' }} />,
      opts,
    );
    await screen.findByLabelText(WITHHOLD);
    await expect(container).toHaveNoViolations();
  });
});
