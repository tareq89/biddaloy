import { createRootRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { academicYearFactory } from '../test/factories';
import { server } from '../test/msw/server';
import { renderWithRouter } from '../test/render-with-router';

import { ClosedYearNotice, useIsYearClosed } from './closed-year-notice';

function serveYear(closed: boolean) {
  server.use(
    http.get('/api/v1/academic-years/:id', ({ params }) =>
      HttpResponse.json(
        academicYearFactory({
          id: params.id as string,
          name: '2026',
          closed_at: closed ? '2026-12-31T00:00:00.000Z' : null,
        }),
      ),
    ),
  );
}

function Probe({ id }: { id: string }) {
  const closed = useIsYearClosed(id);
  return (
    <>
      <ClosedYearNotice academicYearId={id} />
      <button type="button" disabled={closed}>
        Save
      </button>
    </>
  );
}

function renderProbe() {
  return renderWithRouter(createRootRoute({ component: () => <Probe id="year-1" /> }), {
    initialEntries: ['/'],
    tenantId: 'tenant-1',
    locale: 'en',
  });
}

describe('ClosedYearNotice', () => {
  it('names the closed year, links to Academic years and disables Save', async () => {
    serveYear(true);
    renderProbe();
    expect(await screen.findByText(/2026 is closed\. Reopen it on Academic years/)).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Academic years' });
    expect(link.getAttribute('href')).toBe('/academic-years/year-1');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true);
  });

  it('shows nothing and leaves Save enabled for an open year', async () => {
    serveYear(false);
    renderProbe();
    const save = await screen.findByRole('button', { name: 'Save' });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('status')).toBeNull();
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });
});
