import type { TabSpec } from './tab-spec';

/**
 * Natural key -> entity id lookup for one tab.
 *
 * Workbook cells reference other rows by *natural key* (e.g. a class named
 * `Six`), never by uuid, because uuids differ between the source and the
 * destination school. `KeyIndex` is what turns one back into the other:
 * built from the destination's existing entities before an import, it lets
 * `ImportContext.ref` answer "which local row is this key?".
 *
 * ### Duplicate keys are recorded, not silently resolved
 *
 * A `naturalKey` is only unique if the data says so, and real tenant data
 * violates that (two guardians with the same name, two classes named `Six`
 * in different years). A plain last-write-wins map would quietly attach
 * imported rows to an arbitrary one of them. Instead the first id wins and
 * the key is recorded in {@link duplicateKeys}, so the import engine can
 * raise a `RowError` naming the ambiguity rather than guessing.
 */
export class KeyIndex {
  private readonly byKey = new Map<string, string>();
  private readonly ambiguous = new Set<string>();

  add(key: string, id: string): void {
    const existing = this.byKey.get(key);
    if (existing === undefined) {
      this.byKey.set(key, id);
      return;
    }
    // Re-adding the same id is a no-op, not an ambiguity.
    if (existing !== id) {
      this.ambiguous.add(key);
    }
  }

  get(key: string): string | undefined {
    return this.byKey.get(key);
  }

  /** True when two or more distinct entities share this natural key. */
  isAmbiguous(key: string): boolean {
    return this.ambiguous.has(key);
  }

  /** Every natural key held by more than one entity. */
  get duplicateKeys(): readonly string[] {
    return [...this.ambiguous];
  }

  get size(): number {
    return this.byKey.size;
  }

  /**
   * Builds an index over already-loaded entities using the tab's own
   * `keyOf`, so key derivation lives in exactly one place (the spec)
   * rather than being re-implemented per call site.
   */
  static fromEntities<E, R>(spec: TabSpec<E, R>, entities: readonly E[]): KeyIndex {
    const index = new KeyIndex();
    for (const entity of entities) {
      // Every tab's entity carries a uuid `id`, but TabSpec cannot express
      // that in its type parameter without constraining E across all 18
      // tabs — so the assumption is checked at runtime instead of trusted.
      const id: unknown = (entity as { id?: unknown }).id;
      if (typeof id !== 'string') {
        throw new TypeError(
          `KeyIndex.fromEntities: tab "${spec.name}" produced an entity with no string \`id\`.`,
        );
      }
      index.add(spec.keyOf(entity), id);
    }
    return index;
  }
}
