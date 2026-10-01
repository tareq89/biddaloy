import { BadRequestException } from '@nestjs/common';
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

/** [33.2.1] Rejects a non-null value that isn't in the tenant's own
 * vocabulary for this dimension. `null`/`undefined` is always allowed —
 * clearing/omitting the field never needs a vocabulary to check against
 * (D5's "this tenant doesn't use this dimension"). A *non-null* value is
 * validated even when the vocabulary is empty, which means it is always
 * rejected in that case: an empty vocabulary is "tenant hasn't configured
 * anything yet", not "tenant accepts anything" — the value is unvalidated
 * input crossing a trust boundary, and there is nothing configured to
 * check it against, so it's refused rather than written blind. Matching
 * is case-sensitive: the DTO that writes the vocabulary itself (33.1.1)
 * already blocks case-variant duplicates from entering it. */
export function assertInVocabulary(
  value: string | null | undefined,
  vocabulary: string[],
  field: string,
): void {
  if (value === null || value === undefined) return;
  if (!vocabulary.includes(value)) {
    throw new BadRequestException(
      `"${value}" is not a configured ${field}. Configure it in organisation settings first.`,
    );
  }
}
