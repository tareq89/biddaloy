/**
 * Keyboard-operability assertions. Neither jest-dom's `toHaveFocus()` nor
 * any other custom focus matcher is available here (jest-dom is
 * deliberately not installed — see `render-with-providers.tsx`'s own
 * README note), so these compare `document.activeElement` directly.
 */
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { expect, vi, type Mock } from 'vitest';

interface KeyboardOptions {
  user?: UserEvent;
  /** Bound on how many Tab presses count as "not reachable" — generous for
   * a component-test fixture, not a real page. */
  maxTabStops?: number;
  /**
   * A spy already wired to the component's own activation handler (e.g.
   * the `onClick` passed to it, created with `vi.fn()`). Preferred over
   * the default: a custom `role="button"` widget's keydown handling
   * typically calls its handler prop directly rather than dispatching a
   * real `click` Event, so relying on a native `click` listener alone
   * would report a correctly-wired custom widget as keyboard-inoperable.
   * Omit only for native elements (`<button>`, `<a href>`, ...), which
   * dispatch a real `click` on their own.
   */
  onActivate?: Mock;
}

/**
 * Asserts `element` is reachable from `document.body` by pressing Tab, and
 * that both Enter and Space activate it — checked via `onActivate` if
 * given, otherwise by listening for a native `click` event (which is what
 * native interactive elements dispatch on their own; a custom widget only
 * does this if its own keydown handling triggers it — exactly what the
 * WAI-ARIA authoring practices require, so one that hasn't wired it up
 * fails here rather than only failing manually).
 */
export async function expectKeyboardOperable(
  element: HTMLElement,
  { user = userEvent.setup(), maxTabStops = 25, onActivate }: KeyboardOptions = {},
): Promise<void> {
  const onClick = vi.fn();
  const activationSpy = onActivate ?? onClick;
  if (!onActivate) {
    element.addEventListener('click', onClick);
  }

  try {
    (document.activeElement as HTMLElement | null)?.blur();

    let reached = false;
    for (let i = 0; i < maxTabStops; i++) {
      await user.tab();
      if (document.activeElement === element) {
        reached = true;
        break;
      }
    }
    expect(
      reached,
      `expected Tab to reach ${describeElement(element)} within ${maxTabStops} stops`,
    ).toBe(true);

    activationSpy.mockClear();
    await user.keyboard('{Enter}');
    expect(
      activationSpy,
      `expected Enter to activate ${describeElement(element)}`,
    ).toHaveBeenCalled();

    activationSpy.mockClear();
    await user.keyboard(' ');
    expect(
      activationSpy,
      `expected Space to activate ${describeElement(element)}`,
    ).toHaveBeenCalled();
  } finally {
    element.removeEventListener('click', onClick);
  }
}

/** Asserts Tab visits `elements` in exactly this order, starting from
 * whatever currently has focus (usually `document.body`). */
export async function expectTabOrder(
  elements: readonly HTMLElement[],
  { user = userEvent.setup() }: Pick<KeyboardOptions, 'user'> = {},
): Promise<void> {
  for (const [index, element] of elements.entries()) {
    await user.tab();
    expect(
      document.activeElement,
      `expected tab stop ${index + 1} to be ${describeElement(element)}`,
    ).toBe(element);
  }
}

function describeElement(element: HTMLElement): string {
  const label = element.getAttribute('aria-label') ?? element.textContent?.trim();
  return `<${element.tagName.toLowerCase()}>${label ? ` "${label}"` : ''}`;
}
