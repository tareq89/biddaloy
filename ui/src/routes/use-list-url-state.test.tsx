import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { useListUrlState } from './use-list-url-state';

function Probe({ defaults }: { defaults?: { page?: number; limit?: number } }) {
  const [state, update] = useListUrlState(defaults);
  return (
    <div>
      <p>page: {state.page}</p>
      <p>limit: {state.limit}</p>
      <button onClick={() => update({ limit: 25 })}>Set limit</button>
    </div>
  );
}

describe('useListUrlState', () => {
  it('falls back to limit 10 when no default and no URL value are given', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Probe />
      </MemoryRouter>,
    );

    expect(screen.getByText('limit: 10')).toBeTruthy();
  });

  it('honours a caller-supplied default limit', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Probe defaults={{ limit: 25 }} />
      </MemoryRouter>,
    );

    expect(screen.getByText('limit: 25')).toBeTruthy();
  });

  it('update({ limit }) writes limit into the URL, independent of page/sort/filters', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <Probe />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Set limit' }));

    expect(screen.getByText('limit: 25')).toBeTruthy();
    expect(screen.getByText('page: 1')).toBeTruthy();
  });
});
