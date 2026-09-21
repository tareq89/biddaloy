import { describe, it, expect } from 'vitest';
import { diffOrganisationVocabulary } from './organisation-vocabulary.util';

describe('diffOrganisationVocabulary', () => {
  it('reports added, removed, and unchanged entries per list', () => {
    const diff = diffOrganisationVocabulary(
      { shifts: ['Morning', 'Day'], versions: ['Bangla'], groups: [] },
      { shifts: ['Morning', 'Evening'], versions: ['Bangla', 'English'], groups: [] },
    );

    expect(diff.shifts).toEqual({ added: ['Evening'], removed: ['Day'], unchanged: ['Morning'] });
    expect(diff.versions).toEqual({ added: ['English'], removed: [], unchanged: ['Bangla'] });
    expect(diff.groups).toEqual({ added: [], removed: [], unchanged: [] });
  });

  it('is case-sensitive — a case-variant is both a removal and an addition', () => {
    const diff = diffOrganisationVocabulary(
      { shifts: ['Morning'], versions: [], groups: [] },
      { shifts: ['morning'], versions: [], groups: [] },
    );

    expect(diff.shifts).toEqual({ added: ['morning'], removed: ['Morning'], unchanged: [] });
  });

  it('treats a missing previous/next section as an empty list', () => {
    const diff = diffOrganisationVocabulary(undefined, {
      shifts: ['Morning'],
      versions: [],
      groups: [],
    });
    expect(diff.shifts).toEqual({ added: ['Morning'], removed: [], unchanged: [] });

    const diff2 = diffOrganisationVocabulary(
      { shifts: ['Morning'], versions: [], groups: [] },
      undefined,
    );
    expect(diff2.shifts).toEqual({ added: [], removed: ['Morning'], unchanged: [] });
  });
});
