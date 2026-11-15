import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { usePrintPageRule } from './use-print-page-rule';

const pageRules = () =>
  [...document.head.querySelectorAll('style')].filter((s) => s.textContent?.includes('@page'));

describe('usePrintPageRule (#1374)', () => {
  it('adds the @page rule while mounted and removes it on unmount', () => {
    const { unmount } = renderHook(() => usePrintPageRule('size: landscape; margin: 10mm;'));
    expect(pageRules()).toHaveLength(1);
    expect(pageRules()[0]?.textContent).toContain('size: landscape');
    unmount();
    expect(pageRules()).toHaveLength(0);
  });
});
