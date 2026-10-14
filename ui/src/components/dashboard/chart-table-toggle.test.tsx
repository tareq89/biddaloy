import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ChartTableToggle, type ChartTableToggleProps } from './chart-table-toggle';

const props: Omit<ChartTableToggleProps, 'children'> = {
  summary: 'Lowest 86.8%, highest 91.8% over 30 days',
  table: {
    caption: 'Attendance by day',
    columns: ['Day', 'Rate'],
    rows: [
      ['1', '90%'],
      ['2', '88%'],
    ],
    numeric: [false, true],
  },
  showTableLabel: 'Show as table',
  showChartLabel: 'Show chart',
};
const chart = <svg data-testid="chart" role="img" aria-label="chart" />;

describe('ChartTableToggle', () => {
  it('starts in chart view', () => {
    render(<ChartTableToggle {...props}>{chart}</ChartTableToggle>);
    expect(screen.getByTestId('chart')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    const btn = screen.getByRole('button', { name: 'Show as table' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('switches to the table and keeps focus on the toggle', async () => {
    render(<ChartTableToggle {...props}>{chart}</ChartTableToggle>);
    const btn = screen.getByRole('button', { name: 'Show as table' });
    await userEvent.click(btn);
    const table = screen.getByRole('table', { name: 'Attendance by day' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Day', 'Rate']);
    for (const cell of ['1', '90%', '2', '88%']) {
      expect(within(table).getByText(cell)).toBeTruthy();
    }
    expect(screen.queryByTestId('chart')).toBeNull();
    expect(btn.textContent).toContain('Show chart');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(btn);
  });

  it('right-aligns numeric columns only', () => {
    render(
      <ChartTableToggle {...props} defaultView="table">
        {chart}
      </ChartTableToggle>,
    );
    expect(screen.getByText('90%').className).toContain('text-right');
    expect(screen.getByText('1').className).not.toContain('text-right');
  });

  it('defaultView table starts in table view', () => {
    render(
      <ChartTableToggle {...props} defaultView="table">
        {chart}
      </ChartTableToggle>,
    );
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.queryByTestId('chart')).toBeNull();
  });

  it('keeps the summary in both views', async () => {
    render(<ChartTableToggle {...props}>{chart}</ChartTableToggle>);
    expect(screen.getByText(props.summary)).toBeTruthy();
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByText(props.summary)).toBeTruthy();
  });

  it('is axe clean in both views', async () => {
    const { container } = render(<ChartTableToggle {...props}>{chart}</ChartTableToggle>);
    await expect(container).toHaveNoViolations();
    await userEvent.click(screen.getByRole('button'));
    await expect(container).toHaveNoViolations();
  });
});
