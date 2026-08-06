import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectKeyboardOperable, expectTabOrder, LINK_KEYS } from './keyboard';

describe('toHaveNoViolations', () => {
  it('is available with no per-file setup and passes for an accessible form', async () => {
    const { container } = render(
      <form>
        <label htmlFor="name">Name</label>
        <input id="name" type="text" />
      </form>,
    );

    await expect(container).toHaveNoViolations();
  });

  it('fails a component with a missing form label', async () => {
    const { container } = render(<input type="text" />);

    await expect(expect(container).toHaveNoViolations()).rejects.toThrow();
  });
});

describe('expectKeyboardOperable', () => {
  it('passes for a native button (click dispatched natively)', async () => {
    const onClick = vi.fn();
    render(<button onClick={onClick}>Save</button>);

    await expectKeyboardOperable(screen.getByRole('button', { name: 'Save' }));
  });

  it('passes for a custom role="button" widget when given its activation spy', async () => {
    const onActivate = vi.fn();
    render(
      <div
        role="button"
        tabIndex={0}
        onClick={onActivate}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onActivate();
          }
        }}
      >
        Custom action
      </div>,
    );

    await expectKeyboardOperable(screen.getByRole('button', { name: 'Custom action' }), {
      onActivate,
    });
  });

  it('passes for a native link with LINK_KEYS (Enter only)', async () => {
    render(<a href="#students">Students</a>);

    await expectKeyboardOperable(screen.getByRole('link', { name: 'Students' }), {
      keys: LINK_KEYS,
    });
  });

  it('a real link fails the default BUTTON_KEYS check — Space does not activate a link', async () => {
    render(<a href="#students">Students</a>);

    await expect(
      expectKeyboardOperable(screen.getByRole('link', { name: 'Students' })),
    ).rejects.toThrow(/Space to activate/);
  });

  it('fails for an element that Tab cannot reach', async () => {
    render(<div>Not focusable</div>);

    await expect(
      expectKeyboardOperable(screen.getByText('Not focusable'), { maxTabStops: 3 }),
    ).rejects.toThrow(/Tab to reach/);
  });

  it('fails for a focusable element whose keydown handling never activates it', async () => {
    render(
      <div role="button" tabIndex={0}>
        Looks like a button, does nothing
      </div>,
    );

    await expect(
      expectKeyboardOperable(screen.getByRole('button', { name: /Looks like a button/ })),
    ).rejects.toThrow(/Enter to activate/);
  });
});

describe('expectTabOrder', () => {
  it('asserts the expected tab sequence', async () => {
    render(
      <>
        <button>First</button>
        <button>Second</button>
        <button>Third</button>
      </>,
    );

    await expectTabOrder([
      screen.getByRole('button', { name: 'First' }),
      screen.getByRole('button', { name: 'Second' }),
      screen.getByRole('button', { name: 'Third' }),
    ]);
  });

  it('fails when the actual order diverges from the expected order', async () => {
    render(
      <>
        <button>First</button>
        <button>Second</button>
      </>,
    );

    await expect(
      expectTabOrder([
        screen.getByRole('button', { name: 'Second' }),
        screen.getByRole('button', { name: 'First' }),
      ]),
    ).rejects.toThrow(/tab stop 1/);
  });
});

describe('a component that manages its own children (dynamic focus)', () => {
  it('remains keyboard operable across a state update', async () => {
    function Toggle() {
      const [on, setOn] = useState(false);
      return (
        <button onClick={() => setOn((v) => !v)} aria-pressed={on}>
          {on ? 'On' : 'Off'}
        </button>
      );
    }

    render(<Toggle />);
    const button = screen.getByRole('button');
    await expectKeyboardOperable(button);
  });
});
