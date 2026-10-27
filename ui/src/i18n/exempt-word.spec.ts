/**
 * [#2917] The exempt mark must use one Bangla word on the marks pages
 * (the keyboard help, the cell label and the blank-cell warning).
 */
import { describe, expect, it } from 'vitest';

import bnCommon from './locales/bn/common.json';
import bnExams from './locales/bn/exams.json';
import bnGrading from './locales/bn/grading.json';

describe('bn exempt word', () => {
  const word = bnCommon.marksEntry.exempt;
  const strings = {
    keyboardHelp: bnGrading.marksSheet.keyboardHelp,
    blankBlocksSubmit_one: bnGrading.marksSheet.blankBlocksSubmit_one,
    blankBlocksSubmit_other: bnGrading.marksSheet.blankBlocksSubmit_other,
    exemptShort: bnExams.marksGrid.exemptShort,
  };

  it.each(Object.entries(strings))('%s uses the common word', (_key, text) => {
    expect(text).toContain(word);
    expect(text).not.toContain('অব্যাহতি');
  });
});
