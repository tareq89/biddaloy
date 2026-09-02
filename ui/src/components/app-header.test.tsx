import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppHeader } from './app-header';

describe('AppHeader', () => {
  it('renders the start slot on the left and the end slot on the right', () => {
    render(<AppHeader start={<span>Greenview School</span>} end={<button>Search</button>} />);

    expect(screen.getByText('Greenview School')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy();
  });

  it('is axe clean', async () => {
    const { baseElement } = render(
      <AppHeader start={<span>Greenview School</span>} end={<button>Search</button>} />,
    );
    await expect(baseElement).toHaveNoViolations();
  });
});
