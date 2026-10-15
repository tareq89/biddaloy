/**
 * [169.2-11] The draft layout the customise panel edits. Pure: nothing is
 * saved until the user presses Save, then `toPref` makes the PATCH body.
 */
import {
  WIDGET_CATALOGUE,
  type DashboardLayoutPref,
  type DashboardWidgetKey,
  type WidgetSize,
} from '@biddaloy/shared';

import type { LayoutItem } from '../resolve-layout';

export interface DraftState {
  shown: LayoutItem[];
  hidden: LayoutItem[];
}

export type DraftAction =
  | { type: 'toggle'; key: DashboardWidgetKey }
  | { type: 'move'; key: DashboardWidgetKey; dir: -1 | 1 }
  | { type: 'resize'; key: DashboardWidgetKey; size: WidgetSize }
  | { type: 'reset'; defaults: DraftState };

export function customiseReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case 'toggle': {
      const inShown = state.shown.find((i) => i.key === action.key);
      if (inShown) {
        return {
          shown: state.shown.filter((i) => i !== inShown),
          hidden: [inShown, ...state.hidden],
        };
      }
      const inHidden = state.hidden.find((i) => i.key === action.key);
      if (!inHidden) return state;
      return {
        shown: [...state.shown, inHidden],
        hidden: state.hidden.filter((i) => i !== inHidden),
      };
    }
    case 'move': {
      const from = state.shown.findIndex((i) => i.key === action.key);
      const to = from + action.dir;
      if (from < 0 || to < 0 || to >= state.shown.length) return state;
      const shown = [...state.shown];
      [shown[from], shown[to]] = [shown[to]!, shown[from]!];
      return { ...state, shown };
    }
    case 'resize': {
      if (!WIDGET_CATALOGUE[action.key].sizes.includes(action.size)) return state;
      const set = (list: LayoutItem[]) =>
        list.map((i) => (i.key === action.key ? { ...i, size: action.size } : i));
      return { shown: set(state.shown), hidden: set(state.hidden) };
    }
    case 'reset':
      return action.defaults;
  }
}

/** Shown first (in order), then hidden; array order is display order. */
export function toPref({ shown, hidden }: DraftState): DashboardLayoutPref {
  return {
    widgets: [
      ...shown.map(({ key, size }) => ({ key, size })),
      ...hidden.map(({ key, size }) => ({ key, size, hidden: true })),
    ],
  };
}
