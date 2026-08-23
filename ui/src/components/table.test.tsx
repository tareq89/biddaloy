import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

function Demo() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead>Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>January 2026</TableCell>
          <TableCell>৳500.00</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

describe('Table', () => {
  it('renders a real table with headers and cells, and is axe clean', async () => {
    const { container } = render(<Demo />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Month' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '৳500.00' })).toBeTruthy();
    await expect(container).toHaveNoViolations();
  });

  it('forwards a caption as an accessible table description', () => {
    render(
      <Table>
        <caption>A student&apos;s fee breakdown</caption>
        <TableBody>
          <TableRow>
            <TableCell>Row</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole('table', { name: "A student's fee breakdown" })).toBeTruthy();
  });
});
