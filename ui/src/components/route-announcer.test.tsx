import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RouteAnnouncer } from './route-announcer';

describe('RouteAnnouncer', () => {
  it('renders a polite, visually hidden live region with the given message', () => {
    const { container } = render(<RouteAnnouncer message="Students" />);
    const region = container.querySelector('[data-slot="route-announcer"]');
    expect(region?.textContent).toBe('Students');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.className).toContain('sr-only');
  });

  it('renders an empty (silent) region when message is null', () => {
    const { container } = render(<RouteAnnouncer message={null} />);
    expect(container.querySelector('[data-slot="route-announcer"]')?.textContent).toBe('');
  });

  it('is axe clean', async () => {
    const { container } = render(<RouteAnnouncer message="Students" />);
    await expect(container).toHaveNoViolations();
  });
});
