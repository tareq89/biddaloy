import { afterEach, describe, expect, it, vi } from 'vitest';

import { openPrintWindow } from './open-print-window';

const fakeWindow = () => ({ opener: 'x', close: vi.fn(), print: vi.fn(), location: { href: '' } });

afterEach(() => vi.restoreAllMocks());

describe('openPrintWindow', () => {
  it('opens the window before prepare resolves', async () => {
    const w = fakeWindow();
    const open = vi.spyOn(window, 'open').mockReturnValue(w as unknown as Window);
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:1', revokeObjectURL: vi.fn() });
    let openedWhenPrepared = false;
    await openPrintWindow(() => {
      openedWhenPrepared = open.mock.calls.length === 1;
      return Promise.resolve('<html></html>');
    }, vi.fn());
    expect(openedWhenPrepared).toBe(true);
    expect(w.opener).toBeNull();
    expect(w.location.href).toBe('blob:1');
    vi.unstubAllGlobals();
  });

  it('closes the window and reports when prepare rejects', async () => {
    const w = fakeWindow();
    vi.spyOn(window, 'open').mockReturnValue(w as unknown as Window);
    const onError = vi.fn();
    await openPrintWindow(() => Promise.reject(new Error('POST failed')), onError);
    expect(w.close).toHaveBeenCalled();
    expect(w.location.href).toBe('');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'POST failed' }));
  });

  it('reports POPUP_BLOCKED when window.open returns null', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const prepare = vi.fn();
    const onError = vi.fn();
    await openPrintWindow(prepare, onError);
    expect(prepare).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'POPUP_BLOCKED' }));
  });
});
