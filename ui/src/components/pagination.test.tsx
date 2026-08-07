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

  it('clamps a page past the last page instead of rendering an overflowing range', () => {
    // 145 items at 20/page is 8 pages; a stale `?page=999` (e.g. left over
    // after a filter shrinks the result set) must not produce "19961–145".
    render(<Pagination page={999} pageSize={20} totalCount={145} onPageChange={vi.fn()} />);
    expect(screen.getByText('Showing 141–145 of 145')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true);
  });

  it('clamps a page below 1 instead of rendering a negative range', () => {
    render(<Pagination page={0} pageSize={20} totalCount={145} onPageChange={vi.fn()} />);
    expect(screen.getByText('Showing 1–20 of 145')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled')).toBe(true);
  });

  it('Previous/Next move relative to the clamped page, not the invalid input', async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(<Pagination page={999} pageSize={20} totalCount={145} onPageChange={onPageChange} />);
    // Clamped to page 8 (the last real page) — Previous should go to 7,
    // not 998, which would leave a caller stuck in invalid territory.
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onPageChange).toHaveBeenCalledWith(7);
  });

  it('treats a zero or negative pageSize as 1 rather than dividing by zero', () => {
    render(<Pagination page={1} pageSize={0} totalCount={145} onPageChange={vi.fn()} />);
    expect(screen.getByText('Showing 1–1 of 145')).toBeTruthy();
    // Math.ceil(145 / 0) is Infinity — a real totalPages must exist so
    // Next is enabled (not stuck disabled) and eventually terminates.
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(false);
  });
});
