import { render as rtlRender, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider, i18n, whenReady } from '../i18n';

import { Timeline, type TimelineItem } from './timeline';

const ITEMS: TimelineItem[] = [
  { id: 'a', title: 'Submitted', time: '2026-03-01T09:30:00Z', badge: 'Pending', tone: 'warning' },
  { id: 'b', title: 'Approved', time: '2026-03-02T10:00:00Z', body: 'Looks fine' },
];

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: I18nProvider });

beforeEach(async () => {
  await whenReady(i18n);
  await i18n.changeLanguage('en');
});

describe('Timeline', () => {
  it('renders an ordered list in the given order', () => {
    render(<Timeline aria-label="History" items={ITEMS} />);
    const list = screen.getByRole('list', { name: 'History' });
    expect(list.tagName).toBe('OL');
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Submitted');
    expect(rows[1]?.textContent).toContain('Approved');
  });

  it('renders a <time> with dateTime and formatted text', () => {
    const { container } = render(<Timeline aria-label="History" items={ITEMS} />);
    const time = container.querySelector('time');
    expect(time?.getAttribute('dateTime')).toBe('2026-03-01T09:30:00Z');
    expect(time?.textContent).toBeTruthy();
    expect(time?.textContent).not.toBe('2026-03-01T09:30:00Z');
  });

  it('keeps the time of day (two times on one date read differently)', () => {
    const { container } = render(
      <Timeline
        aria-label="History"
        items={[
          { id: 'a', title: 'A', time: '2026-03-01T03:30:00Z' },
          { id: 'b', title: 'B', time: '2026-03-01T09:45:00Z' },
        ]}
      />,
    );
    const [first, second] = Array.from(container.querySelectorAll('time'));
    expect(first?.textContent).not.toBe(second?.textContent);
  });

  it('shows the badge only when given', () => {
    render(<Timeline aria-label="History" items={ITEMS} />);
    expect(screen.getByText('Pending')).toBeTruthy();
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[1]!).queryByText('Pending')).toBeNull();
    expect(rows[1]!.querySelectorAll('[data-slot="badge"], .rounded-full')).toHaveLength(0);
  });

  it('shows emptyText for an empty list', () => {
    render(<Timeline aria-label="History" items={[]} emptyText="No history yet" />);
    expect(screen.getByText('No history yet')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('falls back to the shared empty text', () => {
    render(<Timeline aria-label="History" items={[]} />);
    expect(screen.getByText(i18n.t('table.empty'))).toBeTruthy();
  });
});
