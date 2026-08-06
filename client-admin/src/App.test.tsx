import '@beton-boi/ui/test';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import App from './App';

describe('App', () => {
  it('renders the admin welcome copy', () => {
    render(<App />);
    expect(screen.getByText('beton-boi Admin')).toBeTruthy();
  });

  // toHaveNoViolations() is registered globally at runtime (ui/src/test/
  // setup.ts, via vitest.config.ts's shared setupFiles) regardless of what
  // any given test file imports. The `@beton-boi/ui/test` import above is
  // only needed for *type-checking* this file — see that barrel's own
  // comment on why.
  it('has no accessibility violations', async () => {
    const { container } = render(<App />);
    await expect(container).toHaveNoViolations();
  });
});
