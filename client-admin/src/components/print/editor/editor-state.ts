/**
 * [32.3.1] The template editor's state (D31, D36): the working draft, which side
 * and element are in focus, zoom, and an undo/redo history.
 *
 * RULES, all enforced here so no UI code can break them:
 *  - Every change is re-validated with `validateTemplateDefinition`. A change
 *    that would make the draft invalid is REFUSED (state unchanged).
 *  - Geometry never fails validation: a move or resize is CLAMPED to the page.
 *  - History is capped at 50 steps; any new change clears the redo stack.
 *  - Positions are kept to 0.1 mm so repeated nudges don't drift.
 */
import {
  DocumentKind,
  FIELD_CATALOG,
  ImageFit,
  OverflowPolicy,
  ShapeKind,
  validateTemplateDefinition,
  type PrintElement,
  type TemplateDefinition,
} from '@biddaloy/shared';

export type EditorSide = 'front' | 'back';
export type NewElementType = PrintElement['type'];

export const HISTORY_LIMIT = 50;
export const ZOOM_MIN = 100;
export const ZOOM_MAX = 400;

export interface EditorState {
  kind: DocumentKind;
  draft: TemplateDefinition;
  side: EditorSide;
  selectedId: string | null;
  /** Percent. 100 = the card at its natural on-screen size. */
  zoom: number;
  past: TemplateDefinition[];
  future: TemplateDefinition[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type EditorAction =
  | { type: 'ADD_ELEMENT'; element: PrintElement }
  | { type: 'UPDATE_ELEMENT'; id: string; patch: Record<string, unknown> }
  | { type: 'REMOVE_ELEMENT'; id: string }
  | { type: 'REORDER_ELEMENT'; id: string; toIndex: number }
  | { type: 'MOVE_BY'; id: string; dxMm: number; dyMm: number }
  | { type: 'SET_RECT'; id: string; rect: Partial<Rect> }
  /** Paper size and/or sides. Elements are re-fitted to the new page; a dropped back side is discarded. */
  | { type: 'SET_PAGE'; page: { widthMm?: number; heightMm?: number; sides?: 'front' | 'both' } }
  /** The copy label text ("Copy {n}", "DUPLICATE"); `undefined` removes it. */
  | { type: 'SET_COPY_LABEL'; text: string | undefined }
  /** The current side's artwork. `assetId: null` removes it; `print` says whether it is printed. */
  | { type: 'SET_BACKGROUND'; assetId: string | null; print?: boolean }
  /** An imported SVG: its cleaned artwork becomes the background AND its fields are added — ONE undo step. */
  | { type: 'IMPORT_SVG'; assetId: string; elements: PrintElement[] }
  | { type: 'SET_SIDE'; side: EditorSide }
  | { type: 'SET_ZOOM'; zoom: number }
  | { type: 'SELECT'; id: string | null }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  /** The server copy replaced the draft (first load, or after a reload). Resets history. */
  | { type: 'REPLACE_DRAFT'; draft: TemplateDefinition };

const round = (n: number) => Math.round(n * 10) / 10;

export function initEditorState(draft: TemplateDefinition, kind: DocumentKind): EditorState {
  return { kind, draft, side: 'front', selectedId: null, zoom: 200, past: [], future: [] };
}

export const elementsOf = (draft: TemplateDefinition, side: EditorSide): PrintElement[] =>
  (side === 'back' ? draft.back?.elements : draft.front.elements) ?? [];

/** Keeps a rectangle inside the page: never larger than it, never hanging off an edge. */
export function clampRect(rect: Rect, page: { widthMm: number; heightMm: number }): Rect {
  const w = Math.min(Math.max(rect.w, 1), page.widthMm);
  const h = Math.min(Math.max(rect.h, 1), page.heightMm);
  return {
    w: round(w),
    h: round(h),
    x: round(Math.min(Math.max(rect.x, 0), page.widthMm - w)),
    y: round(Math.min(Math.max(rect.y, 0), page.heightMm - h)),
  };
}

/** A fresh, unused element id (`el-1`, `el-2`, …) across BOTH sides. */
export function newElementId(draft: TemplateDefinition): string {
  const used = new Set([...draft.front.elements, ...(draft.back?.elements ?? [])].map((e) => e.id));
  let n = used.size + 1;
  while (used.has(`el-${n}`)) n += 1;
  return `el-${n}`;
}

/** An IMAGE element that shows an uploaded asset (a signature, a seal), centred on the page. */
export function createImageFromAsset(assetId: string, draft: TemplateDefinition): PrintElement {
  const w = Math.min(24, draft.page.widthMm);
  const rect = clampRect(
    { w, h: w, x: (draft.page.widthMm - w) / 2, y: (draft.page.heightMm - w) / 2 },
    draft.page,
  );
  return {
    id: newElementId(draft),
    type: 'IMAGE',
    ...rect,
    assetId,
    fit: ImageFit.CONTAIN,
    alignY: 'center',
  };
}

/** A valid new element of `type`, centred on the page (D36: new elements start at the centre). */
export function createElement(
  type: NewElementType,
  draft: TemplateDefinition,
  kind: DocumentKind,
): PrintElement {
  const id = newElementId(draft);
  const size: Record<NewElementType, { w: number; h: number }> = {
    TEXT: { w: 40, h: 6 },
    IMAGE: { w: 20, h: 20 },
    QR: { w: 18, h: 18 },
    SHAPE: { w: 30, h: 10 },
  };
  const rect = clampRect(
    {
      w: size[type].w,
      h: size[type].h,
      x: (draft.page.widthMm - size[type].w) / 2,
      y: (draft.page.heightMm - size[type].h) / 2,
    },
    draft.page,
  );
  switch (type) {
    case 'TEXT':
      return {
        id,
        type,
        ...rect,
        text: 'Text',
        fontFamily: 'Biddaloy Sans',
        sizePt: 10,
        weight: 400,
        color: '#000000',
        align: 'left',
        overflow: OverflowPolicy.SHRINK,
      };
    case 'IMAGE': {
      // An image needs exactly one source; start on the kind's first image field (e.g. the photo).
      const field = FIELD_CATALOG[kind].find((f) => f.type === 'image')?.key ?? 'school.logo';
      return { id, type, ...rect, field, fit: ImageFit.COVER, alignY: 'top' };
    }
    case 'QR':
      return { id, type, ...rect };
    case 'SHAPE':
      return {
        id,
        type,
        ...rect,
        shape: ShapeKind.RECT,
        stroke: '#000000',
        strokeWidthMm: 0.3,
        radiusMm: 0,
      };
  }
}

/** Replaces the elements of one side. */
function withElements(
  draft: TemplateDefinition,
  side: EditorSide,
  elements: PrintElement[],
): TemplateDefinition {
  if (side === 'back') {
    return draft.back ? { ...draft, back: { ...draft.back, elements } } : draft;
  }
  return { ...draft, front: { ...draft.front, elements } };
}

/** Which side an element lives on (an id is unique across both sides). */
const sideOf = (draft: TemplateDefinition, id: string): EditorSide | undefined =>
  draft.front.elements.some((e) => e.id === id)
    ? 'front'
    : draft.back?.elements.some((e) => e.id === id)
      ? 'back'
      : undefined;

/** Applies a new draft: validate, push history. A refused (invalid) draft leaves the state as it was. */
function commit(
  state: EditorState,
  next: TemplateDefinition,
  selectedId = state.selectedId,
): EditorState {
  if (next === state.draft) return state;
  if (!validateTemplateDefinition(next, state.kind).success) return state;
  return {
    ...state,
    draft: next,
    selectedId,
    past: [...state.past, state.draft].slice(-HISTORY_LIMIT),
    future: [],
  };
}

function mapElement(
  state: EditorState,
  id: string,
  fn: (el: PrintElement) => PrintElement,
): TemplateDefinition {
  const side = sideOf(state.draft, id);
  if (!side) return state.draft;
  return withElements(
    state.draft,
    side,
    elementsOf(state.draft, side).map((el) => (el.id === id ? fn(el) : el)),
  );
}

/** A copy of `obj` without `key` (so the property is absent, not `undefined`). */
function omit<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

/** Re-fits every element of both sides into the (possibly new) page. */
function refit(draft: TemplateDefinition): TemplateDefinition {
  const fit = (els: PrintElement[]) => els.map((el) => ({ ...el, ...clampRect(el, draft.page) }));
  return {
    ...draft,
    front: { ...draft.front, elements: fit(draft.front.elements) },
    ...(draft.back ? { back: { ...draft.back, elements: fit(draft.back.elements) } } : {}),
  };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'ADD_ELEMENT': {
      const elements = [...elementsOf(state.draft, state.side), action.element];
      return commit(state, withElements(state.draft, state.side, elements), action.element.id);
    }

    case 'UPDATE_ELEMENT': {
      const next = mapElement(state, action.id, (el) => {
        const merged = { ...el, ...action.patch } as Record<string, unknown>;
        // `undefined` in a patch means "remove this property" (e.g. switching TEXT from text to field).
        for (const [k, v] of Object.entries(action.patch)) if (v === undefined) delete merged[k];
        // Geometry is clamped to the page, never refused.
        if (['x', 'y', 'w', 'h'].some((k) => k in action.patch)) {
          Object.assign(merged, clampRect(merged as unknown as Rect, state.draft.page));
        }
        return merged as unknown as PrintElement;
      });
      return commit(state, next);
    }

    case 'REMOVE_ELEMENT': {
      const side = sideOf(state.draft, action.id);
      if (!side) return state;
      const elements = elementsOf(state.draft, side).filter((el) => el.id !== action.id);
      return commit(
        state,
        withElements(state.draft, side, elements),
        state.selectedId === action.id ? null : state.selectedId,
      );
    }

    case 'REORDER_ELEMENT': {
      const side = sideOf(state.draft, action.id);
      if (!side) return state;
      const elements = [...elementsOf(state.draft, side)];
      const from = elements.findIndex((el) => el.id === action.id);
      const to = Math.min(Math.max(action.toIndex, 0), elements.length - 1);
      if (from === to) return state;
      const [moved] = elements.splice(from, 1);
      elements.splice(to, 0, moved as PrintElement);
      return commit(state, withElements(state.draft, side, elements));
    }

    case 'MOVE_BY': {
      const current = [...state.draft.front.elements, ...(state.draft.back?.elements ?? [])].find(
        (el) => el.id === action.id,
      );
      if (!current) return state;
      return editorReducer(state, {
        type: 'SET_RECT',
        id: action.id,
        rect: { x: current.x + action.dxMm, y: current.y + action.dyMm },
      });
    }

    case 'SET_RECT': {
      const current = [...state.draft.front.elements, ...(state.draft.back?.elements ?? [])].find(
        (el) => el.id === action.id,
      );
      if (!current) return state;
      const target = clampRect(
        { x: current.x, y: current.y, w: current.w, h: current.h, ...action.rect },
        state.draft.page,
      );
      // Already there (e.g. nudging into a wall): not a change, so no history entry.
      if (
        target.x === current.x &&
        target.y === current.y &&
        target.w === current.w &&
        target.h === current.h
      ) {
        return state;
      }
      return commit(
        state,
        mapElement(state, action.id, (el) => ({ ...el, ...target })),
      );
    }

    case 'SET_PAGE': {
      const { sides, ...size } = action.page;
      const page = {
        ...state.draft.page,
        ...(size.widthMm !== undefined ? { widthMm: size.widthMm } : {}),
        ...(size.heightMm !== undefined ? { heightMm: size.heightMm } : {}),
        ...(sides === 'both' ? { sides: ['front', 'back'] as ['front', 'back'] } : {}),
        ...(sides === 'front' ? { sides: ['front'] as ['front'] } : {}),
      };
      let next: TemplateDefinition = { ...state.draft, page };
      if (sides === 'both' && !next.back) next = { ...next, back: { elements: [] } };
      if (sides === 'front' && next.back) next = omit(next, 'back');
      const result = commit(state, refit(next));
      // Losing the back side while looking at it: go to the front.
      return result.draft.back || result.side === 'front'
        ? result
        : { ...result, side: 'front', selectedId: null };
    }

    case 'SET_COPY_LABEL': {
      const rest = omit(state.draft, 'copyLabel');
      const next = (
        action.text === undefined ? rest : { ...rest, copyLabel: { text: action.text } }
      ) as TemplateDefinition;
      return commit(state, next);
    }

    case 'SET_BACKGROUND': {
      const side = state.side;
      const target = side === 'back' ? state.draft.back : state.draft.front;
      if (!target) return state;
      const { background: previous, ...rest } = target;
      const nextSide =
        action.assetId === null
          ? rest
          : {
              ...rest,
              background: {
                assetId: action.assetId,
                print: action.print ?? previous?.print ?? true,
              },
            };
      return commit(state, {
        ...state.draft,
        ...(side === 'back' ? { back: nextSide } : { front: nextSide }),
      });
    }

    case 'IMPORT_SVG': {
      const side = state.side;
      const target = side === 'back' ? state.draft.back : state.draft.front;
      if (!target) return state;
      // Fresh ids (the importer's are only unique among themselves) and page-clamped rects.
      let draft = state.draft;
      const added: PrintElement[] = [];
      for (const el of action.elements) {
        const id = newElementId({
          ...draft,
          front: { ...draft.front, elements: [...draft.front.elements, ...added] },
        });
        added.push({ ...el, id, ...clampRect(el, draft.page) });
      }
      const nextSide = {
        ...target,
        elements: [...target.elements, ...added],
        background: { assetId: action.assetId, print: target.background?.print ?? true },
      };
      draft = { ...draft, ...(side === 'back' ? { back: nextSide } : { front: nextSide }) };
      return commit(state, draft, added.at(-1)?.id ?? state.selectedId);
    }

    case 'SET_SIDE':
      if (action.side === 'back' && !state.draft.back) return state;
      return { ...state, side: action.side, selectedId: null };

    case 'SET_ZOOM':
      return { ...state, zoom: Math.min(Math.max(Math.round(action.zoom), ZOOM_MIN), ZOOM_MAX) };

    case 'SELECT':
      return { ...state, selectedId: action.id };

    case 'UNDO': {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return {
        ...state,
        draft: previous,
        past: state.past.slice(0, -1),
        future: [state.draft, ...state.future],
        selectedId: sideOf(previous, state.selectedId ?? '') ? state.selectedId : null,
      };
    }

    case 'REDO': {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return {
        ...state,
        draft: next,
        past: [...state.past, state.draft].slice(-HISTORY_LIMIT),
        future: rest,
        selectedId: sideOf(next, state.selectedId ?? '') ? state.selectedId : null,
      };
    }

    case 'REPLACE_DRAFT':
      return { ...state, draft: action.draft, past: [], future: [], selectedId: null };
  }
}
