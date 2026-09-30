import { DocumentKind, type PrintElement, type TemplateDefinition } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import {
  HISTORY_LIMIT,
  clampRect,
  createElement,
  editorReducer,
  elementsOf,
  initEditorState,
  newElementId,
  type EditorAction,
  type EditorState,
} from './editor-state';

const KIND = DocumentKind.STUDENT_ID_CARD;

const text = (id: string, over: Record<string, unknown> = {}): PrintElement => ({
  id,
  type: 'TEXT',
  x: 10,
  y: 10,
  w: 30,
  h: 6,
  text: 'Hello',
  fontFamily: 'Biddaloy Sans',
  sizePt: 10,
  weight: 400,
  color: '#000000',
  align: 'left',
  overflow: 'SHRINK',
  ...over,
});

const draft = (front: PrintElement[] = [text('a')], twoSided = false): TemplateDefinition => ({
  page: { widthMm: 85.6, heightMm: 54, sides: twoSided ? ['front', 'back'] : ['front'] },
  front: { elements: front },
  ...(twoSided ? { back: { elements: [] } } : {}),
});

const run = (state: EditorState, ...actions: EditorAction[]) =>
  actions.reduce(editorReducer, state);
const start = (d = draft()) => initEditorState(d, KIND);
const at = (state: EditorState, id: string) =>
  elementsOf(state.draft, state.side).find((e) => e.id === id)!;

describe('clampRect', () => {
  const page = { widthMm: 85.6, heightMm: 54 };
  it('keeps a rectangle inside the page on every edge', () => {
    expect(clampRect({ x: -5, y: -5, w: 10, h: 10 }, page)).toMatchObject({ x: 0, y: 0 });
    expect(clampRect({ x: 200, y: 200, w: 10, h: 10 }, page)).toMatchObject({ x: 75.6, y: 44 });
  });
  it('shrinks a rectangle that is bigger than the page, and never lets it reach zero', () => {
    expect(clampRect({ x: 0, y: 0, w: 500, h: 500 }, page)).toMatchObject({ w: 85.6, h: 54 });
    expect(clampRect({ x: 0, y: 0, w: 0, h: -3 }, page)).toMatchObject({ w: 1, h: 1 });
  });
});

describe('moving', () => {
  it('MOVE_BY moves in millimetres', () => {
    const s = run(start(), { type: 'MOVE_BY', id: 'a', dxMm: 0.5, dyMm: 5 });
    expect(at(s, 'a')).toMatchObject({ x: 10.5, y: 15 });
  });

  it('clamps to the page instead of refusing the move', () => {
    const s = run(start(), { type: 'MOVE_BY', id: 'a', dxMm: 1000, dyMm: -1000 });
    expect(at(s, 'a')).toMatchObject({ x: 55.6, y: 0 }); // 85.6 - 30 wide, top edge
  });

  it('keeps repeated half-millimetre nudges exact (no float drift)', () => {
    const s = run(
      start(),
      ...Array.from({ length: 20 }, (): EditorAction => ({
        type: 'MOVE_BY',
        id: 'a',
        dxMm: 0.1,
        dyMm: 0,
      })),
    );
    expect(at(s, 'a').x).toBe(12);
  });

  it('pushing into a wall changes nothing, so it adds no undo step', () => {
    const atWall = run(start(), { type: 'MOVE_BY', id: 'a', dxMm: -1000, dyMm: 0 });
    const again = run(atWall, { type: 'MOVE_BY', id: 'a', dxMm: -1, dyMm: 0 });
    expect(again.past).toHaveLength(atWall.past.length);
  });
});

describe('undo / redo', () => {
  it('restores the exact previous draft, and redo restores the change', () => {
    const initial = start();
    const moved = run(initial, { type: 'MOVE_BY', id: 'a', dxMm: 5, dyMm: 0 });
    const undone = run(moved, { type: 'UNDO' });
    expect(undone.draft).toEqual(initial.draft);
    expect(run(undone, { type: 'REDO' }).draft).toEqual(moved.draft);
  });

  it('a new change after undo drops the redo stack', () => {
    const s = run(
      start(),
      { type: 'MOVE_BY', id: 'a', dxMm: 5, dyMm: 0 },
      { type: 'UNDO' },
      { type: 'MOVE_BY', id: 'a', dxMm: 1, dyMm: 0 },
    );
    expect(s.future).toEqual([]);
  });

  it('undo and redo with nothing to do are no-ops', () => {
    const s = start();
    expect(run(s, { type: 'UNDO' })).toBe(s);
    expect(run(s, { type: 'REDO' })).toBe(s);
  });

  it(`keeps at most ${HISTORY_LIMIT} undo steps`, () => {
    const moves = Array.from({ length: HISTORY_LIMIT + 20 }, (_, i): EditorAction => ({
      type: 'MOVE_BY',
      id: 'a',
      dxMm: i % 2 ? -0.5 : 0.5,
      dyMm: 0,
    }));
    const s = run(start(), ...moves);
    expect(s.past).toHaveLength(HISTORY_LIMIT);
  });
});

describe('adding, removing and reordering', () => {
  it('gives every new element a unique id, across both sides', () => {
    let s = start(draft([text('a')], true));
    s = run(s, { type: 'ADD_ELEMENT', element: createElement('QR', s.draft, KIND) });
    s = run(s, { type: 'SET_SIDE', side: 'back' });
    s = run(s, { type: 'ADD_ELEMENT', element: createElement('QR', s.draft, KIND) });
    const ids = [...s.draft.front.elements, ...(s.draft.back?.elements ?? [])].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(newElementId(s.draft)).not.toBeNull();
  });

  it('places a new element at the centre of the page and selects it', () => {
    const s0 = start();
    const el = createElement('TEXT', s0.draft, KIND);
    const s = run(s0, { type: 'ADD_ELEMENT', element: el });
    expect(s.selectedId).toBe(el.id);
    expect(el.x + el.w / 2).toBeCloseTo(85.6 / 2, 0);
    expect(el.y + el.h / 2).toBeCloseTo(54 / 2, 0);
  });

  it.each(['TEXT', 'IMAGE', 'QR', 'SHAPE'] as const)(
    'a new %s element is valid as it is',
    (type) => {
      const s0 = start();
      const s = run(s0, { type: 'ADD_ELEMENT', element: createElement(type, s0.draft, KIND) });
      expect(elementsOf(s.draft, 'front')).toHaveLength(2); // accepted by validation, not refused
    },
  );

  it('removing the selected element clears the selection', () => {
    const s = run(start(), { type: 'SELECT', id: 'a' }, { type: 'REMOVE_ELEMENT', id: 'a' });
    expect(elementsOf(s.draft, 'front')).toHaveLength(0);
    expect(s.selectedId).toBeNull();
  });

  it('reorders layers', () => {
    const s = run(start(draft([text('a'), text('b'), text('c')])), {
      type: 'REORDER_ELEMENT',
      id: 'c',
      toIndex: 0,
    });
    expect(elementsOf(s.draft, 'front').map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('validation', () => {
  it('refuses a change that would make the draft invalid, leaving the state untouched', () => {
    const s0 = start();
    // A TEXT element needs exactly one of text / field: giving it both is invalid.
    const s = run(s0, { type: 'UPDATE_ELEMENT', id: 'a', patch: { field: 'student.name' } });
    expect(s).toBe(s0);
  });

  it('refuses a field that is not in the catalog for this document type', () => {
    const s0 = start();
    const s = run(s0, {
      type: 'UPDATE_ELEMENT',
      id: 'a',
      patch: { text: undefined, field: 'staff.designation' },
    });
    expect(s).toBe(s0);
  });

  it('switching TEXT from static text to a catalog field works when the old property is removed', () => {
    const s = run(start(), {
      type: 'UPDATE_ELEMENT',
      id: 'a',
      patch: { text: undefined, field: 'student.name' },
    });
    expect(at(s, 'a')).toMatchObject({ field: 'student.name' });
    expect('text' in at(s, 'a')).toBe(false);
  });

  it('clamps a geometry update to the page instead of refusing it', () => {
    const s = run(start(), { type: 'UPDATE_ELEMENT', id: 'a', patch: { w: 9999 } });
    expect(at(s, 'a')).toMatchObject({ w: 85.6, x: 0 });
  });
});

describe('the rest', () => {
  it('will not switch to a back side that does not exist', () => {
    const s0 = start();
    expect(run(s0, { type: 'SET_SIDE', side: 'back' }).side).toBe('front');
  });

  it('keeps zoom between 100% and 400%', () => {
    expect(run(start(), { type: 'SET_ZOOM', zoom: 50 }).zoom).toBe(100);
    expect(run(start(), { type: 'SET_ZOOM', zoom: 900 }).zoom).toBe(400);
  });

  it('replacing the draft (a reload from the server) starts a fresh history', () => {
    const moved = run(start(), { type: 'MOVE_BY', id: 'a', dxMm: 5, dyMm: 0 });
    const s = run(moved, { type: 'REPLACE_DRAFT', draft: draft([text('z')]) });
    expect(s.past).toEqual([]);
    expect(s.selectedId).toBeNull();
    expect(elementsOf(s.draft, 'front')[0]!.id).toBe('z');
  });
});
