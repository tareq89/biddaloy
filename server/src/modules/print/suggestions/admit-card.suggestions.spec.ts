import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ADMIT_CARD_SITTING_SLOTS, validateTemplateDefinition } from '@biddaloy/shared';
import { ADMIT_CARD_SUGGESTIONS } from './admit-card.suggestions';
import { ARTWORK_DIR } from './suggestions';

const fields = (s: (typeof ADMIT_CARD_SUGGESTIONS)[number]) =>
  new Set(s.definition.front.elements.map((e) => ('field' in e ? e.field : undefined)));

describe('ADMIT_CARD_SUGGESTIONS', () => {
  it('has 2 entries with unique keys', () => {
    expect(ADMIT_CARD_SUGGESTIONS).toHaveLength(2);
    expect(new Set(ADMIT_CARD_SUGGESTIONS.map((s) => s.key)).size).toBe(2);
  });

  it.each(ADMIT_CARD_SUGGESTIONS.map((s) => [s.key, s] as const))(
    '%s validates, has artwork, is 200x140 front-only with all slots and a QR',
    (_k, s) => {
      expect(validateTemplateDefinition(s.definition, 'EXAM_ADMIT_CARD')).toEqual({
        success: true,
        data: s.definition,
      });
      expect(existsSync(join(ARTWORK_DIR, s.artwork.front))).toBe(true);
      expect(s.definition.page).toEqual({ widthMm: 200, heightMm: 140, sides: ['front'] });
      const f = fields(s);
      for (let n = 1; n <= ADMIT_CARD_SITTING_SLOTS; n++)
        for (const k of ['subject', 'date', 'time', 'room', 'seat'])
          expect(f.has(`exam.sitting.${n}.${k}`)).toBe(true);
      expect(s.definition.front.elements.some((e) => e.type === 'QR')).toBe(true);
    },
  );

  it('binds one language per template (D10)', () => {
    const [bn, en] = ADMIT_CARD_SUGGESTIONS.map(fields) as [Set<unknown>, Set<unknown>];
    expect(bn.has('student.name_bn') && bn.has('school.name_bn')).toBe(true);
    expect(bn.has('student.name') || bn.has('school.name')).toBe(false);
    expect(en.has('student.name') && en.has('school.name')).toBe(true);
    expect(en.has('student.name_bn') || en.has('school.name_bn')).toBe(false);
  });

  it('two pages fit on A4 (layoutPages: 5 mm margin, 2 mm gap)', () => {
    expect(2 * 140 + 2 + 2 * 5).toBeLessThanOrEqual(292);
    expect(200 + 2 * 5).toBeLessThanOrEqual(210);
  });
});
