import { createRootRoute, createRoute, useNavigate } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Popover, PopoverContent, PopoverTrigger } from '../components/popover';
import { renderWithRouter } from '../test/render-with-router';

import { FullPageShell, useCloseFullPage, type FullPageShellProps } from './full-page-shell';

const primary = { label: 'Save', onClick: () => {} };
function setup(props: Partial<FullPageShellProps> = {}) {
  const onClose = vi.fn();
  const utils = renderWithRouter(
    createRootRoute({
      component: () => (
        <FullPageShell title="Add student" onClose={onClose} primary={primary} {...props}>
          <p>body</p>
        </FullPageShell>
      ),
    }),
    { locale: 'en' },
  );
  return { onClose, ...utils };
}

describe('FullPageShell', () => {
  it('renders h1 title, Close, and is axe clean', async () => {
    const { baseElement, localeReady } = setup();
    await localeReady;
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Add student');
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    await expect(baseElement).toHaveNoViolations();
  });

  it('not dirty: Close and Esc call onClose', async () => {
    const user = userEvent.setup();
    const { onClose, localeReady } = setup();
    await localeReady;
    await user.click(await screen.findByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('dirty: Close asks first; keep editing stays, discard closes', async () => {
    const user = userEvent.setup();
    const { onClose, localeReady } = setup({ dirty: true });
    await localeReady;
    await user.click(await screen.findByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a body that suspends does not leave the focus trap stealing focus from overlays inside', async () => {
    // A lazily loaded namespace suspends the body mid-life. Before the shell had its own
    // Suspense, that hid the whole dialog, Radix dropped its focus trap from the stack,
    // and focus moving into a popover / dialog opened inside was pulled straight back
    // (a popover then closes at once). A modal Dialog here would make the two traps fight
    // forever in jsdom; a Popover fails cleanly.
    let load = () => {};
    const loaded = new Promise<void>((resolve) => (load = resolve));
    const Late = React.lazy(async () => {
      await loaded;
      return { default: () => <p>loaded</p> };
    });
    function Body() {
      const [late, setLate] = React.useState(false);
      const [name, setName] = React.useState('');
      return (
        <>
          <button type="button" onClick={() => setLate(true)}>
            load
          </button>
          {late && <Late />}
          <Popover>
            <PopoverTrigger>open</PopoverTrigger>
            <PopoverContent>
              <label htmlFor="typed">Name</label>
              <input id="typed" value={name} onChange={(e) => setName(e.target.value)} />
            </PopoverContent>
          </Popover>
        </>
      );
    }
    const user = userEvent.setup();
    const { localeReady } = renderWithRouter(
      createRootRoute({
        component: () => (
          <React.Suspense fallback={null}>
            <FullPageShell title="Set up" onClose={() => {}}>
              <Body />
            </FullPageShell>
          </React.Suspense>
        ),
      }),
      { locale: 'en' },
    );
    await localeReady;
    await user.click(await screen.findByText('load'));
    load();
    await screen.findByText('loaded');
    await user.click(screen.getByText('open'));
    const field = await screen.findByLabelText<HTMLInputElement>('Name');
    await user.click(field);
    await user.keyboard('abc');
    expect(field.value).toBe('abc');
  });

  it('wide width, busy primary, secondary on start side', async () => {
    const { localeReady } = setup({
      size: 'wide',
      primary: { ...primary, busy: true },
      secondary: { label: 'Cancel', onClick: () => {} },
    });
    await localeReady;
    expect((await screen.findByText('body')).parentElement?.className).toContain('max-w-5xl');
    expect(screen.getByRole('button', { name: /Save/ }).getAttribute('aria-busy')).toBe('true');
    const footer = screen.getByRole('button', { name: /Save/ }).parentElement;
    expect(footer?.firstElementChild?.textContent).toBe('Cancel');
  });
});

describe('useCloseFullPage', () => {
  function build(fallback: () => void) {
    const root = createRootRoute();
    const Page = () => {
      const navigate = useNavigate();
      const close = useCloseFullPage(fallback);
      return (
        <div>
          <button onClick={() => void navigate({ to: '/a', search: { add: 1 } })}>open</button>
          <button onClick={close}>close</button>
        </div>
      );
    };
    return root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/a', component: Page }),
    ]);
  }

  it('goes back after in-app navigation', async () => {
    const fallback = vi.fn();
    const { router } = renderWithRouter(build(fallback), { initialEntries: ['/a'] });
    const user = userEvent.setup();
    await user.click(await screen.findByText('open'));
    await waitFor(() => expect(router.state.location.search).toEqual({ add: 1 }));
    await user.click(screen.getByText('close'));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls back on a fresh history', async () => {
    const fallback = vi.fn();
    renderWithRouter(build(fallback), { initialEntries: ['/a?add=1'] });
    await userEvent.setup().click(await screen.findByText('close'));
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
