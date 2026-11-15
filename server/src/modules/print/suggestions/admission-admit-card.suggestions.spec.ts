import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateTemplateDefinition } from '@biddaloy/shared';
import { ADMISSION_ADMIT_CARD_SUGGESTIONS } from './admission-admit-card.suggestions';
import { ARTWORK_DIR } from './suggestions';

const fields = (s: (typeof ADMISSION_ADMIT_CARD_SUGGESTIONS)[number]) =>
  new Set(s.definition.front.elements.map((e) => ('field' in e ? e.field : undefined)));

describe('ADMISSION_ADMIT_CARD_SUGGESTIONS', () => {
  it.each(ADMISSION_ADMIT_CARD_SUGGESTIONS.map((s) => [s.key, s] as const))(
    '%s validates against the catalogue, has artwork and shows roll, guardian phone and venue',
    (_k, s) => {
      expect(validateTemplateDefinition(s.definition, 'ADMISSION_ADMIT_CARD')).toEqual({
        success: true,
        data: s.definition,
      });
      expect(existsSync(join(ARTWORK_DIR, s.artwork.front))).toBe(true);
      const f = fields(s);
      for (const k of [
        'applicant.roll',
        'applicant.guardian_phone',
        'applicant.photo',
        'admission.test_date',
        'admission.test_time',
        'admission.venue',
        'school.logo',
      ])
        expect(f.has(k)).toBe(true);
    },
  );
});
