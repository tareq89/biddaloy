import { DocumentKind, type PrintElement, type TemplateDefinition } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import {
  createElement,
  createImageFromAsset,
  editorReducer,
  elementsOf,
  initEditorState,
  type EditorAction,
  type EditorState,
} from './editor-state';

/**
 * The paths `editor-state.test.ts` does not reach: the back side, ids that do not exist,
 * no-op actions, and history that crosses sides. Each is a place the reducer must leave the
 * state alone (or route to the right side) rather than throw.
 */

const KIND = DocumentKind.STUDENT_ID_CARD;
const ASSET = '33333333-3333-4333-8333-333333333333';

const text = (id: string): PrintElement => ({
  id,
  type: 'TEXT',
  x: 10,
  y: 10,
  w: 30,
  h: 6,
  text: 'Hi',
  fontFamily: 'Biddaloy Sans',
  sizePt: 10,
  weight: 400,
  color: '#000000',
  align: 'left',
  overflow: 'SHRINK',
});

const twoSided = (front: PrintElement[] = [text('f1')], back: PrintElement[] = [text('b1')]) =>
  ({
    page: { widthMm: 85.6, heightMm: 54, sides: ['front', 'back'] },
    front: { elements: front },
    back: { elements: back },
  }) as TemplateDefinition;
const oneSided = (front: PrintElement[] = [text('f1')]) =>
  ({
    page: { widthMm: 85.6, heightMm: 54, sides: ['front'] },
    front: { elements: front },
  }) as TemplateDefinition;

const run = (state: EditorState, ...actions: EditorAction[]) =>
  actions.reduce(editorReducer, state);
const start = (d: TemplateDefinition) => initEditorState(d, KIND);

describe('elementsOf', () => {
  it('reads the back side, and is empty for a missing back', () => {
    expect(elementsOf(twoSided(), 'back').map((e) => e.id)).toEqual(['b1']);
    expect(elementsOf(oneSided(), 'back')).toEqual([]);
  });
});

describe('ids that do not exist are ignored', () => {
  const s = start(twoSided());
  it.each<EditorAction>([
    { type: 'UPDATE_ELEMENT', id: 'nope', patch: { x: 1 } },
    { type: 'REMOVE_ELEMENT', id: 'nope' },
    { type: 'REORDER_ELEMENT', id: 'nope', toIndex: 0 },
    { type: 'MOVE_BY', id: 'nope', dxMm: 1, dyMm: 1 },
    { type: 'SET_RECT', id: 'nope', rect: { x: 1 } },
  ])('%j leaves the state untouched', (action) => {
    expect(editorReducer(s, action)).toBe(s);
  });
});

describe('the back side', () => {
  it('adds, edits, moves and removes an element on the back', () => {
    const s = run(start(twoSided()), { type: 'SET_SIDE', side: 'back' });
    const added = run(s, { type: 'ADD_ELEMENT', element: text('b2') });
    expect(elementsOf(added.draft, 'back').map((e) => e.id)).toEqual(['b1', 'b2']);

    const moved = run(added, { type: 'MOVE_BY', id: 'b2', dxMm: 2, dyMm: 3 });
    expect(elementsOf(moved.draft, 'back').find((e) => e.id === 'b2')).toMatchObject({
      x: 12,
      y: 13,
    });

    const removed = run(moved, { type: 'REMOVE_ELEMENT', id: 'b2' });
    expect(elementsOf(removed.draft, 'back').map((e) => e.id)).toEqual(['b1']);
  });

  it('will not switch to a back that does not exist', () => {
    const s = start(oneSided());
    expect(editorReducer(s, { type: 'SET_SIDE', side: 'back' })).toBe(s);
  });

  it('adding to a missing back changes nothing', () => {
    const s: EditorState = { ...start(oneSided()), side: 'back' };
    expect(editorReducer(s, { type: 'ADD_ELEMENT', element: text('x') }).draft).toBe(s.draft);
  });
});

describe('REORDER_ELEMENT', () => {
  const s = start(oneSided([text('a'), text('b'), text('c')]));
  it('moves an element and clamps an out-of-range index', () => {
    const up = run(s, { type: 'REORDER_ELEMENT', id: 'a', toIndex: 99 });
    expect(elementsOf(up.draft, 'front').map((e) => e.id)).toEqual(['b', 'c', 'a']);
    const down = run(s, { type: 'REORDER_ELEMENT', id: 'c', toIndex: -5 });
    expect(elementsOf(down.draft, 'front').map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });
  it('does nothing when the element is already there', () => {
    expect(editorReducer(s, { type: 'REORDER_ELEMENT', id: 'b', toIndex: 1 })).toBe(s);
  });
});

describe('SET_BACKGROUND', () => {
  it('sets, keeps the print flag, and removes the artwork; also on the back', () => {
    const s = start(twoSided());
    const set = run(s, { type: 'SET_BACKGROUND', assetId: ASSET });
    expect(set.draft.front.background).toEqual({ assetId: ASSET, print: true });
    const off = run(set, { type: 'SET_BACKGROUND', assetId: ASSET, print: false });
    // A later call without `print` keeps the previous choice.
    const same = run(off, { type: 'SET_BACKGROUND', assetId: ASSET });
    expect(same.draft.front.background).toEqual({ assetId: ASSET, print: false });
    const cleared = run(same, { type: 'SET_BACKGROUND', assetId: null });
    expect(cleared.draft.front.background).toBeUndefined();

    const back = run(
      s,
      { type: 'SET_SIDE', side: 'back' },
      { type: 'SET_BACKGROUND', assetId: ASSET },
    );
    expect(back.draft.back?.background).toEqual({ assetId: ASSET, print: true });
    expect(back.draft.front.background).toBeUndefined();
  });

  it('ignores a background for a side that is not there', () => {
    const s: EditorState = { ...start(oneSided()), side: 'back' };
    expect(editorReducer(s, { type: 'SET_BACKGROUND', assetId: ASSET })).toBe(s);
  });
});

describe('IMPORT_SVG', () => {
  // A TEXT element has exactly one source: a field here, so no fixed `text`.
  const el = (x: number): PrintElement => {
    const withoutText: Record<string, unknown> = { ...text('imp'), x, field: 'student.name' };
    delete withoutText.text;
    return withoutText as unknown as PrintElement;
  };
  it('lands on the back when the back is showing, with fresh ids and a background', () => {
    const s = run(start(twoSided()), { type: 'SET_SIDE', side: 'back' });
    const out = run(s, { type: 'IMPORT_SVG', assetId: ASSET, elements: [el(5), el(6)] });
    const ids = elementsOf(out.draft, 'back').map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(3);
    expect(out.draft.back?.background).toEqual({ assetId: ASSET, print: true });
    expect(out.selectedId).toBe(ids.at(-1));
  });
  it('keeps the selection when nothing was imported, and ignores a missing back', () => {
    const s = run(start(oneSided()), { type: 'SELECT', id: 'f1' });
    const empty = run(s, { type: 'IMPORT_SVG', assetId: ASSET, elements: [] });
    expect(empty.selectedId).toBe('f1');
    const noBack: EditorState = { ...s, side: 'back' };
    expect(editorReducer(noBack, { type: 'IMPORT_SVG', assetId: ASSET, elements: [el(1)] })).toBe(
      noBack,
    );
  });
});

describe('undo and redo across sides', () => {
  it('drops the selection when the selected element no longer exists after undo / redo', () => {
    const s = run(start(oneSided()), { type: 'ADD_ELEMENT', element: text('new') });
    expect(s.selectedId).toBe('new');
    const undone = run(s, { type: 'UNDO' });
    expect(undone.selectedId).toBeNull();
    const redone = run(undone, { type: 'SELECT', id: 'f1' }, { type: 'REDO' });
    expect(redone.selectedId).toBe('f1'); // f1 exists in the redone draft too
  });
  it('is a no-op with nothing to undo or redo', () => {
    const s = start(oneSided());
    expect(editorReducer(s, { type: 'UNDO' })).toBe(s);
    expect(editorReducer(s, { type: 'REDO' })).toBe(s);
  });
});

describe('element factories', () => {
  it('a new IMAGE falls back to the school logo for a kind with no image field of its own', () => {
    const img = createElement('IMAGE', oneSided(), KIND);
    expect(img).toMatchObject({ type: 'IMAGE' });
    expect('field' in img && typeof img.field === 'string').toBe(true);
  });
  it('createImageFromAsset fits a tiny page and gets an unused id', () => {
    const tiny = {
      page: { widthMm: 12, heightMm: 12, sides: ['front'] },
      front: { elements: [text('el-1')] },
    } as TemplateDefinition;
    const img = createImageFromAsset(ASSET, tiny);
    expect(img.id).not.toBe('el-1');
    expect(img.w).toBeLessThanOrEqual(12);
  });
});

describe('side after history and draft replacement', () => {
  const both = (): TemplateDefinition => twoSided();

  it('UNDO onto a one-sided draft while viewing the back switches to the front', () => {
    const oneSidedStart = start(oneSided());
    const twoSide = editorReducer(oneSidedStart, {
      type: 'SET_PAGE',
      page: { sides: 'both' },
    });
    const viewingBack = run(twoSide, { type: 'SET_SIDE', side: 'back' });
    expect(viewingBack.side).toBe('back');
    const undone = run(viewingBack, { type: 'UNDO' });
    expect(undone.draft.back).toBeUndefined();
    expect(undone.side).toBe('front');
  });

  it('REPLACE_DRAFT with a one-sided draft while viewing the back switches to the front', () => {
    const viewingBack = run(start(both()), { type: 'SET_SIDE', side: 'back' });
    const replaced = run(viewingBack, { type: 'REPLACE_DRAFT', draft: oneSided() });
    expect(replaced.side).toBe('front');
  });

  it('REPLACE_DRAFT keeps the side when the new draft still has a back', () => {
    const viewingBack = run(start(both()), { type: 'SET_SIDE', side: 'back' });
    expect(run(viewingBack, { type: 'REPLACE_DRAFT', draft: both() }).side).toBe('back');
  });
});
