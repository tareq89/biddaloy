import { describe, expect, it } from 'vitest';
import { KeyIndex } from './key-index';
import type { TabSpec } from './tab-spec';

interface Classroom {
  id: string;
  name: string;
}

/**
 * Only `name` and `keyOf` are read by `KeyIndex`; the rest of the contract is
 * stubbed so the fixture stays readable.
 */
const classesTab = {
  name: 'classes',
  keyOf: (x: unknown) => (x as Classroom).name,
} as unknown as TabSpec<Classroom, Classroom>;

describe('KeyIndex', () => {
  it('resolves a natural key to the entity id', () => {
    const index = new KeyIndex();
    index.add('Six', 'id-six');

    expect(index.get('Six')).toBe('id-six');
    expect(index.size).toBe(1);
  });

  it('returns undefined for an unknown key', () => {
    expect(new KeyIndex().get('Nine')).toBeUndefined();
  });

  it('builds an index from entities using the tab keyOf', () => {
    const index = KeyIndex.fromEntities(classesTab, [
      { id: 'id-six', name: 'Six' },
      { id: 'id-seven', name: 'Seven' },
    ]);

    expect(index.get('Six')).toBe('id-six');
    expect(index.get('Seven')).toBe('id-seven');
    expect(index.duplicateKeys).toEqual([]);
  });

  // Business-critical: a natural key is only unique if the tenant's data says
  // so. Silently resolving a collision would attach imported rows to an
  // arbitrary parent, so the collision must be visible to the import engine.
  it('records a collision instead of letting the last entity win', () => {
    const index = KeyIndex.fromEntities(classesTab, [
      { id: 'id-first', name: 'Six' },
      { id: 'id-second', name: 'Six' },
    ]);

    expect(index.get('Six')).toBe('id-first');
    expect(index.isAmbiguous('Six')).toBe(true);
    expect(index.duplicateKeys).toEqual(['Six']);
  });

  it('does not treat the same id added twice as a collision', () => {
    const index = new KeyIndex();
    index.add('Six', 'id-six');
    index.add('Six', 'id-six');

    expect(index.isAmbiguous('Six')).toBe(false);
    expect(index.duplicateKeys).toEqual([]);
  });

  it('throws when an entity has no string id rather than indexing undefined', () => {
    expect(() =>
      KeyIndex.fromEntities(classesTab, [{ name: 'Six' } as unknown as Classroom]),
    ).toThrow(/no string `id`/);
  });
});
