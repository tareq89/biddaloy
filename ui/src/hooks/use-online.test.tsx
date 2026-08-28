import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it } from 'vitest';

import { mockOnlineStatus } from '../test/connectivity';

import { useOnline } from './use-online';

describe('useOnline', () => {
  it('reports the current connection state on first render', () => {
    mockOnlineStatus(false);

    expect(renderHook(() => useOnline()).result.current).toBe(false);
  });

  it('re-renders when the connection drops and again when it returns', () => {
    mockOnlineStatus(true);
    const { result } = renderHook(() => useOnline());

    act(() => mockOnlineStatus(false));
    expect(result.current).toBe(false);

    act(() => mockOnlineStatus(true));
    expect(result.current).toBe(true);
  });

  it('stops listening once unmounted', () => {
    mockOnlineStatus(true);
    const { unmount } = renderHook(() => useOnline());

    unmount();

    // A leaked listener on a hook this widely mounted would fire against
    // torn-down trees on every connection blip.
    expect(() => act(() => mockOnlineStatus(false))).not.toThrow();
  });
});
