import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SentList } from './-sent-list';

afterEach(async () => {
  await cleanupTestState();
});

const ROW = {
  id: 'an-1',
  title: 'Planned maintenance',
  severity: 'REMINDER',
  statusFilter: ['ACTIVE'],
  sms: false,
  email: false,
  schoolsTargeted: 5,
  schoolsSucceeded: 4,
  recipientCount: 6,
  createdByName: null,
  createdAt: '2029-12-31T00:00:00.000Z',
};

async function show(props: Partial<React.ComponentProps<typeof SentList>>) {
  const { localeReady } = renderWithProviders(
    <SentList rows={[]} loading={false} isFetching={false} {...props} />,
    { locale: 'en' },
  );
  await localeReady;
}

describe('SentList', () => {
  it('shows title, schools reached and a dash when the sender is gone', async () => {
    await show({ rows: [ROW] });
    expect((await screen.findAllByText('Planned maintenance')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('4 of 5 schools').length).toBeGreaterThan(0);
    expect(screen.getAllByText('-').length).toBeGreaterThan(0);
  });

  it('empty', async () => {
    await show({});
    expect(await screen.findByText('No announcements yet')).toBeTruthy();
  });

  it('error', async () => {
    await show({ error: 'Could not load the announcements. Try again.' });
    expect(await screen.findByText('Could not load the announcements. Try again.')).toBeTruthy();
  });
});
