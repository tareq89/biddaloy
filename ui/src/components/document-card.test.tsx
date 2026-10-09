import { createRootRoute } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import type * as React from 'react';
import { describe, expect, it } from 'vitest';

import { renderWithRouter } from '../test/render-with-router';

import { DocumentCard } from './document-card';

const UNAVAILABLE = { reason: 'No seat plan yet', fixLabel: 'Make a seat plan', fixHref: '/seat' };

function renderRouted(ui: React.ReactElement) {
  return renderWithRouter(createRootRoute({ component: () => ui }));
}

describe('DocumentCard', () => {
  it('primary is filled, others outline', async () => {
    const { container, rerender } = render(
      <DocumentCard title="Admit" description="d" action={{ label: 'Print', primary: true }} />,
    );
    expect(screen.getByRole('button', { name: 'Print' }).getAttribute('data-variant')).toBe(
      'default',
    );
    await expect(container).toHaveNoViolations();
    rerender(<DocumentCard title="Admit" description="d" action={{ label: 'Print' }} />);
    expect(screen.getByRole('button', { name: 'Print' }).getAttribute('data-variant')).toBe(
      'outline',
    );
    await expect(container).toHaveNoViolations();
  });

  it('unavailable disables the button, describes it by the reason, keeps the fix link', async () => {
    const { container } = renderRouted(
      <DocumentCard
        title="Seat list"
        description="d"
        action={{ label: 'Print' }}
        unavailable={UNAVAILABLE}
      />,
    );
    const button = await screen.findByRole<HTMLButtonElement>('button', { name: 'Print' });
    expect(button.disabled).toBe(true);
    const reason = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(reason?.textContent).toContain('No seat plan yet');
    const link = screen.getByRole('link', { name: 'Make a seat plan' });
    expect(link.getAttribute('href')).toBe('/seat');
    await expect(container).toHaveNoViolations();
  });

  it('href action renders a router link', async () => {
    renderRouted(<DocumentCard title="t" description="d" action={{ label: 'Open', href: '/x' }} />);
    expect((await screen.findByRole('link', { name: 'Open' })).getAttribute('href')).toBe('/x');
  });

  it('heading level defaults to h3 and can be changed', () => {
    const { rerender } = render(
      <DocumentCard title="Admit" description="d" action={{ label: 'Print' }} />,
    );
    expect(screen.getByRole('heading', { name: 'Admit', level: 3 })).toBeTruthy();
    rerender(
      <DocumentCard title="Admit" description="d" action={{ label: 'Print' }} headingLevel="h2" />,
    );
    expect(screen.getByRole('heading', { name: 'Admit', level: 2 })).toBeTruthy();
  });
});
