import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderHookWithProviders } from '../test';

import type { FilterFieldDescriptor } from './filter-bar';
import { useFilterBarState } from './use-filter-bar-state';

const FIELDS: FilterFieldDescriptor[] = [
  { kind: 'text', key: 'search', label: 'Search', primary: true },
  {
    kind: 'select',
    key: 'status',
    label: 'Status',
    allLabel: 'All statuses',
    options: [{ value: 'active', label: 'Active' }],
  },
  {
    kind: 'number-range',
    minKey: 'min_amount',
    maxKey: 'max_amount',
    label: 'Amount',
    minLabel: 'Min',
    maxLabel: 'Max',
  },
];

function setup(
  values: Record<string, string> = {},
  onChange: (patch: Record<string, string | null>) => void = vi.fn(),
) {
  return renderHookWithProviders(
    ({ values: v }: { values: Record<string, string> }) =>
      useFilterBarState({ fields: FIELDS, values: v, onChange }),
    { initialProps: { values } },
  );
}

describe('useFilterBarState', () => {
  it('debounces a run of keystrokes into a single commit, not one per keystroke', async () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const { result } = setup({}, onChange);

      act(() => result.current.setLocalValue('search', 'r'));
      act(() => result.current.setLocalValue('search', 'ra'));
      act(() => result.current.setLocalValue('search', 'rah'));

      expect(onChange).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(300);

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({ search: 'rah' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not revert a concurrent change to a different filter key (stale-closure regression)', async () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const { result, rerender } = setup({ status: 'active' }, onChange);

      act(() => result.current.setLocalValue('search', 'rahim'));
      // A different control (or a URL nav) sets `status` mid-debounce.
      rerender({ values: { status: 'inactive' } });

      await vi.advanceTimersByTimeAsync(300);

      // The commit built from the stale `search` timeout must only patch
      // `search` — it must not carry a stale `status` value along with it.
      expect(onChange).toHaveBeenCalledWith({ search: 'rahim' });
      expect(onChange).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: expect.anything() }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('normalizes Bengali digits to Latin on commit, while the input still echoes the raw text', async () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const { result } = setup({}, onChange);

      act(() => result.current.setLocalValue('search', '০১২'));
      expect(result.current.localValues.search).toBe('০১২');

      await vi.advanceTimersByTimeAsync(300);

      expect(onChange).toHaveBeenCalledWith({ search: '012' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('commits a whitespace-only value as null, not an empty string', async () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const { result } = setup({ search: 'rahim' }, onChange);

      act(() => result.current.setLocalValue('search', '   '));
      await vi.advanceTimersByTimeAsync(300);

      expect(onChange).toHaveBeenCalledWith({ search: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it('resyncs local echo when `values` changes externally', () => {
    const { result, rerender } = setup({ search: 'rahim' });
    expect(result.current.localValues.search).toBe('rahim');

    rerender({ values: { search: 'karim' } });
    expect(result.current.localValues.search).toBe('karim');
  });

  it('does not clobber an in-flight local edit when the incoming value only matches its own normalized echo', () => {
    const onChange = vi.fn();
    const { result, rerender } = setup({}, onChange);

    act(() => result.current.setLocalValue('search', '০১২'));
    expect(result.current.localValues.search).toBe('০১২');

    // Simulates this hook's own debounce commit having already landed
    // upstream: `values.search` now holds the normalized value.
    rerender({ values: { search: '012' } });

    // The raw Bengali-digit echo must survive — it was already the source
    // that produced this exact incoming value.
    expect(result.current.localValues.search).toBe('০১২');
  });

  it('includes a chip for a `values` key no descriptor covers (the invisible-active-filter bug class)', () => {
    const { result } = setup({ student_id: 'stu-1' });
    expect(result.current.chips).toEqual([{ key: 'student_id', value: 'stu-1', label: null }]);
  });

  it('humanizes a known field into its chip label instead of the raw value', () => {
    const { result } = setup({ status: 'active' });
    expect(result.current.chips).toEqual([
      { key: 'status', value: 'active', label: 'Status: Active' },
    ]);
  });

  it('clearFilter emits an explicit null for the cleared key', () => {
    const onChange = vi.fn();
    const { result } = setup({ status: 'active' }, onChange);

    act(() => result.current.clearFilter('status'));
    expect(onChange).toHaveBeenCalledWith({ status: null });
  });

  it('clearAll emits null for every currently active key, descriptor-covered or not', () => {
    const onChange = vi.fn();
    const { result } = setup({ status: 'active', student_id: 'stu-1' }, onChange);

    act(() => result.current.clearAll());
    expect(onChange).toHaveBeenCalledWith({ status: null, student_id: null });
  });

  it('cancels a pending debounce commit for a filter that gets cleared, so a stale keystroke cannot resurrect it', async () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const { result } = setup({}, onChange);

      act(() => result.current.setLocalValue('search', 'rahim'));
      act(() => result.current.clearFilter('search'));

      expect(onChange).toHaveBeenCalledWith({ search: null });
      onChange.mockClear();

      // The debounce timer that would have committed 'rahim' must have
      // been cancelled by `clearFilter` — if it fires anyway, it
      // resurrects the filter right after the user cleared it.
      await vi.advanceTimersByTimeAsync(300);
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels every pending debounce commit on clearAll', async () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const { result } = setup({ status: 'active' }, onChange);

      act(() => result.current.setLocalValue('search', 'rahim'));
      act(() => result.current.setLocalValue('min_amount', '500'));
      act(() => result.current.clearAll());

      onChange.mockClear();
      await vi.advanceTimersByTimeAsync(300);
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears in-flight debounce timers on unmount so a stale commit never fires', async () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const { result, unmount } = setup({}, onChange);

      act(() => result.current.setLocalValue('search', 'rahim'));
      unmount();

      await vi.advanceTimersByTimeAsync(300);
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a rapid retype of the same field cancels the previous pending timer', async () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const { result } = setup({}, onChange);

      act(() => result.current.setLocalValue('search', 'ra'));
      await vi.advanceTimersByTimeAsync(200);
      act(() => result.current.setLocalValue('search', 'rahim'));
      await vi.advanceTimersByTimeAsync(200);
      expect(onChange).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(100);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({ search: 'rahim' });
    } finally {
      vi.useRealTimers();
    }
  });
});
