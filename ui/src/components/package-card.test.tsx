import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PackageCard } from './package-card';

const base = {
  name: 'Starter',
  smsCount: '1,000 SMS',
  priceLabel: '500 taka',
  validityLabel: 'Valid 12 months',
  buyLabel: 'Buy',
};

describe('PackageCard', () => {
  it('renders props and fires buy once', async () => {
    const onBuy = vi.fn();
    const { container } = render(<PackageCard {...base} onBuy={onBuy} />);
    for (const t of ['Starter', '1,000 SMS', '500 taka', 'Valid 12 months']) {
      expect(screen.getByText(t)).toBeTruthy();
    }
    await userEvent.setup().click(screen.getByRole('button', { name: 'Buy' }));
    expect(onBuy).toHaveBeenCalledTimes(1);
    await expect(container).toHaveNoViolations();
  });

  it('disabled shows its reason and describes the button', async () => {
    const onBuy = vi.fn();
    const { container } = render(
      <PackageCard {...base} onBuy={onBuy} disabledReason="Pay the due first" />,
    );
    const button = screen.getByRole('button', { name: 'Buy' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('aria-describedby')).toBe(screen.getByText('Pay the due first').id);
    await userEvent.setup().click(button);
    expect(onBuy).not.toHaveBeenCalled();
    await expect(container).toHaveNoViolations();
  });

  it('busy state has no violations', async () => {
    const { container } = render(<PackageCard {...base} onBuy={() => {}} busy />);
    await expect(container).toHaveNoViolations();
  });
});
