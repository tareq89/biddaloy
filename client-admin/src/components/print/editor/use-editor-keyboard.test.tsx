import { DocumentKind, type PrintElement, type TemplateDefinition } from '@biddaloy/shared';
import { fireEvent, render, within } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { initEditorState, type EditorAction, type EditorState } from './editor-state';
import { useEditorKeyboard } from './use-editor-keyboard';

const LAYER = 'layer';
const el = (id: string): PrintElement => ({
  id,
  type: 'TEXT',
  x: 5,
  y: 5,
  w: 20,
  h: 5,
  text: id,
  fontFamily: 'Biddaloy Sans',
  sizePt: 10,
  weight: 400,
  color: '#000000',
  align: 'left',
  overflow: 'SHRINK',
});
const draft = (ids: string[]): TemplateDefinition => ({
  page: { widthMm: 85.6, heightMm: 54, sides: ['front'] },
  front: { elements: ids.map(el) },
});

function setup(ids: string[], selectedId: string | null) {
  const dispatch = vi.fn<(a: EditorAction) => void>();
  const state: EditorState = {
    ...initEditorState(draft(ids), DocumentKind.STUDENT_ID_CARD),
    selectedId,
  };
  function Harness() {
    const ref = React.useRef<HTMLDivElement>(null);
    useEditorKeyboard(ref, state, dispatch);
    return (
      <div ref={ref} tabIndex={-1} data-testid="root">
        <ul data-layers-list>
          <li>
            <button type="button" data-testid="layer">
              {LAYER}
            </button>
          </li>
        </ul>
        <input data-testid="field" />
      </div>
    );
  }
  const view = render(<Harness />);
  const scoped = within(view.container);
  return {
    dispatch,
    root: scoped.getByTestId('root'),
    getByTestId: (id: string) => scoped.getByTestId(id),
  };
}

describe('useEditorKeyboard', () => {
  it('nudges the selection with the arrows: 0.5 mm, and 5 mm with Shift', () => {
    const { dispatch, root } = setup(['a'], 'a');
    fireEvent.keyDown(root, { key: 'ArrowRight' });
    fireEvent.keyDown(root, { key: 'ArrowLeft' });
    fireEvent.keyDown(root, { key: 'ArrowUp' });
    fireEvent.keyDown(root, { key: 'ArrowDown', shiftKey: true });
    expect(dispatch.mock.calls.map(([a]) => a)).toEqual([
      { type: 'MOVE_BY', id: 'a', dxMm: 0.5, dyMm: 0 },
      { type: 'MOVE_BY', id: 'a', dxMm: -0.5, dyMm: 0 },
      { type: 'MOVE_BY', id: 'a', dxMm: 0, dyMm: -0.5 },
      { type: 'MOVE_BY', id: 'a', dxMm: 0, dyMm: 5 },
    ]);
  });

  it('does nothing with the arrows when nothing is selected', () => {
    const { dispatch, root } = setup(['a'], null);
    fireEvent.keyDown(root, { key: 'ArrowRight' });
    fireEvent.keyDown(root, { key: 'Delete' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('plain Up/Down inside the layers list navigate, but Left/Right and Shift+Up still nudge', () => {
    const { dispatch, getByTestId } = setup(['a'], 'a');
    const layer = getByTestId('layer');
    fireEvent.keyDown(layer, { key: 'ArrowUp' });
    fireEvent.keyDown(layer, { key: 'ArrowDown' });
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.keyDown(layer, { key: 'ArrowRight' });
    fireEvent.keyDown(layer, { key: 'ArrowUp', shiftKey: true });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('ignores every key while typing in a field', () => {
    const { dispatch, getByTestId } = setup(['a'], 'a');
    fireEvent.keyDown(getByTestId('field'), { key: 'Delete' });
    fireEvent.keyDown(getByTestId('field'), { key: 'z', ctrlKey: true });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('Delete and Backspace remove the selection and keep focus on the editor', () => {
    const { dispatch, root } = setup(['a'], 'a');
    fireEvent.keyDown(root, { key: 'Delete' });
    fireEvent.keyDown(root, { key: 'Backspace' });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'REMOVE_ELEMENT', id: 'a' });
    expect(document.activeElement).toBe(root);
  });

  it('Ctrl/Cmd+Z undoes, +Shift or Ctrl+Y redoes; other modified keys are left alone', () => {
    const { dispatch, root } = setup(['a'], 'a');
    fireEvent.keyDown(root, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(root, { key: 'Z', metaKey: true, shiftKey: true });
    fireEvent.keyDown(root, { key: 'y', ctrlKey: true });
    fireEvent.keyDown(root, { key: 'ArrowRight', ctrlKey: true });
    fireEvent.keyDown(root, { key: 'ArrowRight', altKey: true });
    expect(dispatch.mock.calls.map(([a]) => a.type)).toEqual(['UNDO', 'REDO', 'REDO']);
  });

  it('Escape clears the selection', () => {
    const { dispatch, root } = setup(['a'], 'a');
    fireEvent.keyDown(root, { key: 'Escape' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SELECT', id: null });
  });

  it('] and [ walk the layers and wrap around', () => {
    const forward = setup(['a', 'b', 'c'], 'c');
    fireEvent.keyDown(forward.root, { key: ']' });
    expect(forward.dispatch).toHaveBeenLastCalledWith({ type: 'SELECT', id: 'a' });

    const fromNone = setup(['a', 'b'], null);
    fireEvent.keyDown(fromNone.root, { key: ']' });
    expect(fromNone.dispatch).toHaveBeenLastCalledWith({ type: 'SELECT', id: 'a' });

    const back = setup(['a', 'b', 'c'], 'b');
    fireEvent.keyDown(back.root, { key: '[' });
    expect(back.dispatch).toHaveBeenLastCalledWith({ type: 'SELECT', id: 'a' });

    const wrap = setup(['a', 'b', 'c'], 'a');
    fireEvent.keyDown(wrap.root, { key: '[' });
    expect(wrap.dispatch).toHaveBeenLastCalledWith({ type: 'SELECT', id: 'c' });
  });

  it('[ and ] do nothing on an empty side', () => {
    const { dispatch, root } = setup([], null);
    fireEvent.keyDown(root, { key: ']' });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
