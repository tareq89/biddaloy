import { render } from '@testing-library/react';
import { act } from 'react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useContainerWidth } from './use-container-width';

/**
 * `ui/src/test/jsdom-polyfills.ts` stubs `window.ResizeObserver` as a
 * no-op (needed so Radix's popper positioning doesn't throw under jsdom),
 * so it never actually calls back. This test replaces that stub with one
 * that captures the callback so the test can invoke it manually — the
 * same technique the polyfill file's own comment points at as the
 * intended workaround.
 */
class FakeResizeObserver implements ResizeObserver {
  static instances: FakeResizeObserver[] = [];
  callback: ResizeObserverCallback;
  observed: Element | null = null;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed = target;
  }

  unobserve(): void {
    this.observed = null;
  }

  disconnect(): void {
    this.observed = null;
  }

  fire(width: number): void {
    this.callback(
      [
        {
          borderBoxSize: [{ inlineSize: width, blockSize: 0 }],
          contentRect: { width } as DOMRectReadOnly,
        } as unknown as ResizeObserverEntry,
      ],
      this,
    );
  }
}

let originalResizeObserver: typeof ResizeObserver;

beforeEach(() => {
  originalResizeObserver = window.ResizeObserver;
  FakeResizeObserver.instances = [];
  window.ResizeObserver = FakeResizeObserver;
});

afterEach(() => {
  window.ResizeObserver = originalResizeObserver;
});

function Probe({ onWidth }: { onWidth: (width: number | null) => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const width = useContainerWidth(ref);
  onWidth(width);
  return <div ref={ref} />;
}

describe('useContainerWidth', () => {
  it('returns null until the observer first fires', () => {
    const onWidth = vi.fn();
    render(<Probe onWidth={onWidth} />);
    expect(onWidth).toHaveBeenLastCalledWith(null);
  });

  it('returns the observed border-box inline size once the observer fires', () => {
    const onWidth = vi.fn();
    render(<Probe onWidth={onWidth} />);
    const observer = FakeResizeObserver.instances[0];
    expect(observer).toBeDefined();
    act(() => observer!.fire(360));
    expect(onWidth).toHaveBeenLastCalledWith(360);
  });

  it('updates on subsequent resize callbacks', () => {
    const onWidth = vi.fn();
    render(<Probe onWidth={onWidth} />);
    const observer = FakeResizeObserver.instances[0];
    act(() => observer!.fire(360));
    act(() => observer!.fire(900));
    expect(onWidth).toHaveBeenLastCalledWith(900);
  });

  it('disconnects the observer on unmount', () => {
    const onWidth = vi.fn();
    const { unmount } = render(<Probe onWidth={onWidth} />);
    const observer = FakeResizeObserver.instances[0];
    unmount();
    expect(observer!.observed).toBeNull();
  });
});
