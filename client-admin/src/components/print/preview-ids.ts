/**
 * [2696] Which people the print preview shows. A short list stays in the URL (`?ids=`, shareable);
 * a long one goes in router history state, so 500 selected people cannot make the URL too long
 * (431/414) and a refresh still finds them.
 */
declare module '@tanstack/history' {
  interface HistoryState {
    printIds?: string[];
  }
}

export const URL_IDS_MAX = 40;

export function previewIdsNav(ids: string[]): {
  search: { ids?: string };
  state: { printIds?: string[] };
} {
  return ids.length <= URL_IDS_MAX
    ? { search: { ids: ids.join(',') }, state: {} }
    : { search: {}, state: { printIds: ids } };
}
