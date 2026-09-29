import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateTemplateDefinition } from '@biddaloy/shared';
import { ARTWORK_DIR, PRINT_SUGGESTIONS } from './suggestions';

describe('PRINT_SUGGESTIONS', () => {
  it('has 8 entries with unique keys', () => {
    expect(PRINT_SUGGESTIONS).toHaveLength(8);
    expect(new Set(PRINT_SUGGESTIONS.map((s) => s.key)).size).toBe(8);
  });

  it.each(PRINT_SUGGESTIONS.map((s) => [s.key, s] as const))(
    '%s validates and its artwork exists',
    (_key, s) => {
      const result = validateTemplateDefinition(s.definition, s.documentKind);
      expect(result).toEqual({ success: true, data: s.definition });
      expect(existsSync(join(ARTWORK_DIR, s.artwork.front))).toBe(true);
      expect(existsSync(join(ARTWORK_DIR, s.artwork.back))).toBe(true);
    },
  );
});
