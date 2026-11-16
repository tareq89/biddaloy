import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateTemplateDefinition } from '@biddaloy/shared';
import { ADMISSION_ADMIT_CARD_SUGGESTIONS } from './admission-admit-card.suggestions';
import { ARTWORK_DIR } from './suggestions';

const fields = (s: (typeof ADMISSION_ADMIT_CARD_SUGGESTIONS)[number]) =>
  new Set(s.definition.front.elements.map((e) => ('field' in e ? e.field : undefined)));

const find = (key: string) => {
  const s = ADMISSION_ADMIT_CARD_SUGGESTIONS.find((x) => x.key === key);
  if (!s) throw new Error(`missing suggestion ${key}`);
  return s;
};

function expectComplete(s: (typeof ADMISSION_ADMIT_CARD_SUGGESTIONS)[number]) {
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
}

describe('ADMISSION_ADMIT_CARD_SUGGESTIONS', () => {
  it('Bengali variant validates, has artwork and shows roll, guardian phone and venue', () => {
    expectComplete(find('admission-admit-card-bn'));
  });

  it('English variant validates, has artwork and shows roll, guardian phone and venue', () => {
    expectComplete(find('admission-admit-card-en'));
  });
});
