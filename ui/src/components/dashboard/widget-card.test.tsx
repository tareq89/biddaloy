import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MenuItem } from '../menu';

import { WidgetCard } from './widget-card';

const base = { title: 'Student attendance' };

describe('WidgetCard full', () => {
  it('labels the section by its heading at the given level', () => {
    render(<WidgetCard {...base} headingLevel={3} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Student attendance' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Student attendance' })).toBeTruthy();
  });

  it('renders value, unit, summary, caption, children and footer', () => {
    render(
      <WidgetCard
        {...base}
        value="91.4%"
        unit="present"
        summary="Up on last week"
        updatedLabel="Updated 2 min ago"
        footer={<a href="/x">Open</a>}
      >
        <p>chart body</p>
      </WidgetCard>,
    );
    for (const t of [
      '91.4%',
      'present',
      'Up on last week',
      'Updated 2 min ago',
      'chart body',
      'Open',
    ])
      expect(screen.getByText(t)).toBeTruthy();
  });

  it('shows a labelled menu button only when `menu` is set', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<WidgetCard {...base} />);
    expect(screen.queryByRole('button')).toBeNull();
    unmount();
    render(<WidgetCard {...base} menuLabel="More" menu={<MenuItem>Export</MenuItem>} />);
    const btn = screen.getByRole('button', { name: 'More' });
    expect(btn.getAttribute('aria-label')).toBe('More');
    await user.click(btn);
    expect(screen.getByRole('menuitem', { name: 'Export' })).toBeTruthy();
  });

  it('loading is busy, hides children, keeps the title', () => {
    render(
      <WidgetCard {...base} loading loadingLabel="Loading attendance">
        <p>chart body</p>
      </WidgetCard>,
    );
    expect(screen.getByText('Loading attendance')).toBeTruthy();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByText('chart body')).toBeNull();
    expect(screen.getByText('Student attendance')).toBeTruthy();
  });

  it('error shows an alert and retries once', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<WidgetCard {...base} error={{ message: 'Failed', retryLabel: 'Retry', onRetry }} />);
    expect(screen.getByRole('alert').textContent).toBe('Failed');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('empty shows reason and action, not children', () => {
    render(
      <WidgetCard {...base} empty={{ reason: 'No data', action: <a href="/a">Add</a> }}>
        <p>chart body</p>
      </WidgetCard>,
    );
    expect(screen.getByText('No data')).toBeTruthy();
    expect(screen.getByText('Add')).toBeTruthy();
    expect(screen.queryByText('chart body')).toBeNull();
  });

  it('loading wins over error', () => {
    render(
      <WidgetCard
        {...base}
        loading
        error={{ message: 'Failed', retryLabel: 'Retry', onRetry: () => {} }}
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('WidgetCard compact', () => {
  it('is one button that expands in place', async () => {
    const user = userEvent.setup();
    const onExpandedChange = vi.fn();
    render(
      <WidgetCard
        {...base}
        variant="compact"
        value="91%"
        summary="Fine"
        footer={<a href="/x">Open</a>}
        onExpandedChange={onExpandedChange}
      >
        <p>chart body</p>
      </WidgetCard>,
    );
    const btn = screen.getByRole('button', { name: /Student attendance/ });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('chart body')).toBeNull();
    await user.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('chart body')).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
    expect(onExpandedChange).toHaveBeenCalledWith(true);
  });

  it('respects controlled `expanded`', async () => {
    const user = userEvent.setup();
    render(
      <WidgetCard {...base} variant="compact" expanded={false}>
        <p>chart body</p>
      </WidgetCard>,
    );
    await user.click(screen.getByRole('button'));
    expect(screen.queryByText('chart body')).toBeNull();
  });
});

describe('WidgetCard a11y', () => {
  it('is axe clean', async () => {
    const { container, rerender } = render(
      <WidgetCard {...base} value="1" summary="s">
        <p>x</p>
      </WidgetCard>,
    );
    await expect(container).toHaveNoViolations();
    rerender(<WidgetCard {...base} variant="compact" value="1" summary="s" defaultExpanded />);
    await expect(container).toHaveNoViolations();
    rerender(
      <WidgetCard {...base} error={{ message: 'F', retryLabel: 'Retry', onRetry: () => {} }} />,
    );
    await expect(container).toHaveNoViolations();
  });
});
