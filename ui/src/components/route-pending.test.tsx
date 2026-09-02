import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ROUTE_PENDING_ATTR, RoutePending } from './route-pending';

describe('RoutePending', () => {
  it('marks itself with the ROUTE_PENDING_ATTR so useRouteFocus can detect it', () => {
    const { container } = render(<RoutePending label="Loading" />);
    expect(container.querySelector(`[${ROUTE_PENDING_ATTR}]`)).toBeTruthy();
  });

  it('announces as a polite, busy status region', () => {
    render(<RoutePending label="Loading" />);
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.getAttribute('aria-live')).toBe('polite');
  });

  it('renders the label visually hidden, not as visible text', () => {
    render(<RoutePending label="Loading students" />);
    const label = screen.getByText('Loading students');
    expect(label.className).toContain('sr-only');
  });

  it('renders a list-shaped skeleton (heading line + table) for variant="list"', () => {
    const { container } = render(<RoutePending variant="list" label="Loading" />);
    expect(container.querySelector('table')).toBeTruthy();
  });

  it('renders a detail-shaped skeleton (field list, no table) by default', () => {
    const { container } = render(<RoutePending label="Loading" />);
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it('renders a form-shaped skeleton for variant="form"', () => {
    const { container } = render(<RoutePending variant="form" label="Loading" />);
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });
});
