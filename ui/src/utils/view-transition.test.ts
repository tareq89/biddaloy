import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VIEW_TRANSITION_FOCUS_TIMEOUT_MS, waitForViewTransition } from './view-transition';

function fakeAnimation(pseudoElement: string | null): Animation {
  let resolveFinished: () => void = () => undefined;
  const finished = new Promise<Animation>((resolve) => {
    resolveFinished = () => resolve(animation);
  });
  const animation = {
    effect: { pseudoElement } as unknown as KeyframeEffect,
    finished,
  } as unknown as Animation & { resolveFinished: () => void };
  (animation as unknown as { resolveFinished: () => void }).resolveFinished = resolveFinished;
  return animation;
}

describe('waitForViewTransition', () => {
  // Saved only to restore in `afterEach` below, never called through this
  // reference with a rebound `this` — safe to detach from `document`.

  const originalStartViewTransition = document.startViewTransition;

  const originalGetAnimations = document.getAnimations;

  beforeEach(() => {
    // jsdom doesn't implement the View Transitions API — stub just enough
    // presence so `waitForViewTransition` doesn't take its "unsupported
    // browser" early-return path in every test.
    (document as unknown as { startViewTransition: unknown }).startViewTransition = vi.fn();
  });

  afterEach(() => {
    (document as unknown as { startViewTransition: unknown }).startViewTransition =
      originalStartViewTransition;
    document.getAnimations = originalGetAnimations;
    vi.useRealTimers();
  });

  it('returns null when the View Transitions API is unsupported', () => {
    (document as unknown as { startViewTransition: unknown }).startViewTransition = undefined;
    expect(waitForViewTransition()).toBeNull();
  });

  it('resolves once every ::view-transition-* animation finishes', async () => {
    const transitionAnim = fakeAnimation('::view-transition-new(app-main-content)');
    const unrelatedAnim = fakeAnimation(null);
    document.getAnimations = vi.fn().mockReturnValue([transitionAnim, unrelatedAnim]);

    const settled = waitForViewTransition();
    expect(settled).not.toBeNull();

    let resolved = false;
    void settled!.then(() => {
      resolved = true;
    });

    // Flush the rAF microtask/task the implementation schedules before it
    // reads `document.getAnimations()`.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await Promise.resolve();
    expect(resolved).toBe(false);

    (transitionAnim as unknown as { resolveFinished: () => void }).resolveFinished();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolved).toBe(true);
  });

  it('resolves immediately when nothing is transitioning', async () => {
    document.getAnimations = vi.fn().mockReturnValue([]);

    const settled = waitForViewTransition();
    expect(settled).not.toBeNull();
    await expect(settled).resolves.toBeUndefined();
  });

  it('resolves after the timeout cap when a transition animation never settles', async () => {
    vi.useFakeTimers();
    const stuckAnim = fakeAnimation('::view-transition-old(app-main-content)');
    document.getAnimations = vi.fn().mockReturnValue([stuckAnim]);

    const settled = waitForViewTransition();
    let resolved = false;
    void settled!.then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(VIEW_TRANSITION_FOCUS_TIMEOUT_MS);
    expect(resolved).toBe(true);
  });

  it('still resolves when a transition animation rejects its finished promise', async () => {
    const rejectingAnim = {
      effect: { pseudoElement: '::view-transition-old(app-main-content)' } as unknown,
      finished: Promise.reject(new Error('transition skipped')),
    } as unknown as Animation;
    // Avoid an unhandled-rejection warning from the raw promise above —
    // `waitForViewTransition` consumes it via `Promise.allSettled`, but
    // the literal here is also referenced directly by the test.
    rejectingAnim.finished.catch(() => undefined);
    document.getAnimations = vi.fn().mockReturnValue([rejectingAnim]);

    await expect(waitForViewTransition()).resolves.toBeUndefined();
  });
});
