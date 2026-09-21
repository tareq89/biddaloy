import type { OrganisationSettings } from '@biddaloy/shared';

/** The three `OrganisationSettings` lists this ticket (33.3.1) guards on
 * settings update — `shifts`/`versions` back `classes.shift`/`.version`,
 * `groups` backs `class_sections.group_name` (33.2.1). */
export type VocabularyListName = 'shifts' | 'versions' | 'groups';

export const VOCABULARY_LIST_NAMES: VocabularyListName[] = ['shifts', 'versions', 'groups'];

export interface VocabularyDiff {
  added: string[];
  removed: string[];
  unchanged: string[];
}

/**
 * Pure diff between a tenant's previous and next `organisation` vocabulary,
 * one `VocabularyDiff` per list. Comparison is case-sensitive — `Morning`
 * and `morning` are different entries, matching `UniqueLabelListConstraint`
 * (33.1.1), which already blocks a case-variant duplicate from entering a
 * list in the first place.
 *
 * A missing `previous`/`next` (the section was never set) is treated as an
 * empty list, not an error — `SchoolsService.updateSettings` calls this
 * with whatever `organisation` a given PATCH actually touches.
 */
export function diffOrganisationVocabulary(
  previous: OrganisationSettings | undefined,
  next: OrganisationSettings | undefined,
): Record<VocabularyListName, VocabularyDiff> {
  const result = {} as Record<VocabularyListName, VocabularyDiff>;
  for (const list of VOCABULARY_LIST_NAMES) {
    const oldValues = previous?.[list] ?? [];
    const newValues = next?.[list] ?? [];
    const newSet = new Set(newValues);
    const oldSet = new Set(oldValues);
    result[list] = {
      added: newValues.filter((value) => !oldSet.has(value)),
      removed: oldValues.filter((value) => !newSet.has(value)),
      unchanged: oldValues.filter((value) => newSet.has(value)),
    };
  }
  return result;
}
