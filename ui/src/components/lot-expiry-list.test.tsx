import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LotExpiryList } from './lot-expiry-list';

const labels = { noExpiryLabel: 'No expiry', soonLabel: 'Expires soon', emptyText: 'No lots' };

describe('LotExpiryList', () => {
  it('keeps order, puts no-expiry rows last, soon is icon + text', async () => {
    const { container } = render(
      <LotExpiryList
        {...labels}
        rows={[
          { id: 'n', remainingLabel: '10 left', expiryLabel: null },
          { id: 'a', remainingLabel: '5 left', expiryLabel: '1 Dec', soon: true },
          { id: 'b', remainingLabel: '7 left', expiryLabel: '1 Jan' },
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      '5 leftExpires soon1 Dec',
      '7 left1 Jan',
      '10 leftNo expiry',
    ]);
    expect(items[0]?.querySelector('svg')).not.toBeNull();
    expect(items[1]?.querySelector('svg')).toBeNull();
    await expect(container).toHaveNoViolations();
  });

  it('shows emptyText', async () => {
    const { container } = render(<LotExpiryList {...labels} rows={[]} />);
    expect(screen.getByText('No lots')).toBeTruthy();
    await expect(container).toHaveNoViolations();
  });
});
