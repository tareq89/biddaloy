import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Pagination } from './pagination';

describe('Pagination', () => {
  it('announces the current range and total', () => {
    render(<Pagination page={2} pageSize={20} totalCount={145} onPageChange={vi.fn()} />);
    expect(screen.getByText('Showing 21–40 of 145')).toBeTruthy();
  });

  it('shows a full first-page range', () => {
    render(<Pagination page={1} pageSize={20} totalCount={145} onPageChange={vi.fn()} />);
    expect(screen.getByText('Showing 1–20 of 145')).toBeTruthy();
  });

  it('clamps the end of the range on the last, partial page', () => {
    render(<Pagination page={8} pageSize={20} totalCount={145} onPageChange={vi.fn()} />);
    expect(screen.getByText('Showing 141–145 of 145')).toBeTruthy();
  });

  it('announces "No results" for an empty set rather than a nonsensical range', () => {
    render(<Pagination page={1} pageSize={20} totalCount={0} onPageChange={vi.fn()} />);
    expect(screen.getByText('No results')).toBeTruthy();
  });

  it('disables Previous on the first page and Next on the last', () => {
    render(<Pagination page={1} pageSize={20} totalCount={20} onPageChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true);
  });

  it('calls onPageChange with the adjacent page', async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(<Pagination page={2} pageSize={20} totalCount={145} onPageChange={onPageChange} />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange).toHaveBeenCalledWith(3);
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('is axe clean', async () => {
    const { container } = render(
      <Pagination page={2} pageSize={20} totalCount={145} onPageChange={vi.fn()} />,
    );
    await expect(container).toHaveNoViolations();
  });
});
