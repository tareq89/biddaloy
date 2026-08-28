import { render } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { useDensity } from './use-density';

/**
 * [8.13.8] density ([design contract §6]). The hook's whole reason to exist
 * is WHERE it writes the attribute, so every assertion here is about
 * `document.documentElement` rather than about rendered output.
 *
 * jsdom applies no stylesheet and resolves no custom properties, so a
 * `getComputedStyle().height` assertion would pass no matter what — the
 * numeric side is proven by `scripts/check-contrast.mjs` (compiled CSS) and
 * `e2e/responsive/target-size.spec.ts` (a real browser at 360x640). What is
 * provable here, and is exactly what the wrapper-`<div>` version got wrong,
 * is ancestry and lifecycle.
 */
function Portalled({ children }: { children: React.ReactNode }) {
  // Stands in for Radix's `DialogPrimitive.Portal`/`DropdownMenu` content,
  // which mount into `document.body` with no `container` override — see
  // `primitives/dialog.tsx`.
  return createPortal(children, document.body);
}

function Comfortable({ children }: { children?: React.ReactNode }) {
  useDensity('comfortable');
  return <div data-testid="shell">{children}</div>;
}

afterEach(() => {
  delete document.documentElement.dataset.density;
});

describe('useDensity', () => {
  it('sets data-density on the document element, not on the calling subtree', () => {
    const { getByTestId } = render(<Comfortable />);

    expect(document.documentElement.dataset.density).toBe('comfortable');
    // The regression this replaced: a wrapper element carrying the attribute.
    expect(getByTestId('shell').closest('[data-density]')).toBe(document.documentElement);
  });

  it('covers portalled content, which a wrapper element cannot', () => {
    const { getByTestId } = render(
      <Comfortable>
        <Portalled>
          <button data-testid="portalled">Close menu</button>
        </Portalled>
      </Comfortable>,
    );

    const portalled = getByTestId('portalled');

    // The portal really did escape the calling subtree...
    expect(getByTestId('shell').contains(portalled)).toBe(false);
    // ...and still inherits the density mode, because the attribute is on an
    // ancestor of `document.body`. Under the wrapper version this resolved to
    // `null`, which is how `app-shell.tsx`'s off-canvas nav — a
    // `DialogContent` — kept 28px controls on a 360px phone.
    expect(portalled.closest('[data-density="comfortable"]')).toBe(document.documentElement);
  });

  it('removes the attribute again on unmount so staff routes stay compact', () => {
    const { unmount } = render(<Comfortable />);
    unmount();

    expect(document.documentElement.hasAttribute('data-density')).toBe(false);
  });

  it('restores a pre-existing value rather than clobbering it', () => {
    document.documentElement.dataset.density = 'someone-elses';

    const { unmount } = render(<Comfortable />);
    expect(document.documentElement.dataset.density).toBe('comfortable');

    unmount();
    expect(document.documentElement.dataset.density).toBe('someone-elses');
  });

  it('leaves the document compact when no route asks for a mode', () => {
    render(<div data-testid="staff" />);

    expect(document.documentElement.hasAttribute('data-density')).toBe(false);
  });
});
