import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SocialButtons } from './social-buttons';

const props = {
  labelFor: (p: string) => `Continue with ${p}`,
  hrefFor: (p: string) => `/start/${p}`,
};

describe('SocialButtons', () => {
  it('renders one link per provider carrying its href', async () => {
    const { container } = render(<SocialButtons {...props} providers={['google', 'facebook']} />);
    expect(screen.getByRole('link', { name: 'Continue with google' }).getAttribute('href')).toBe(
      '/start/google',
    );
    expect(screen.getAllByRole('link')).toHaveLength(2);
    await expect(container).toHaveNoViolations();
  });

  it('renders nothing when there are no providers', () => {
    const { container } = render(<SocialButtons {...props} providers={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('is inert when disabled: out of tab order and click does not navigate', () => {
    render(<SocialButtons {...props} providers={['google']} disabled />);
    const link = screen.getByText('Continue with google').closest('a')!;
    expect(link.getAttribute('aria-disabled')).toBe('true');
    expect(link.tabIndex).toBe(-1);
    // fireEvent returns false when preventDefault was called.
    expect(fireEvent.click(link)).toBe(false);
  });
});
