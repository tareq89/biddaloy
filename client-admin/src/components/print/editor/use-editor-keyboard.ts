/**
 * [32.3.1] Every editor action must be reachable without a mouse (D31). While focus
 * is inside the editor (and not typing in a field):
 *
 *   arrows        move the selected element 0.5 mm      Shift+arrows   5 mm
 *   Delete/Back   remove it                             Esc            clear the selection
 *   Ctrl/Cmd+Z    undo                                  Ctrl/Cmd+Shift+Z (or Ctrl+Y)  redo
 *   [  and  ]     select the previous / next layer
 *
 * The listener sits on the editor's root element, so it only hears keys pressed
 * inside it, and it ignores keys typed into an input, textarea, select or
 * contenteditable so the properties form keeps working normally.
 */
import * as React from 'react';

import { elementsOf, type EditorAction, type EditorState } from './editor-state';

export const NUDGE_MM = 0.5;
export const NUDGE_BIG_MM = 5;

const TYPING =
  'input, textarea, select, [contenteditable="true"], [role="combobox"], [role="listbox"]';

export function useEditorKeyboard(
  rootRef: React.RefObject<HTMLElement | null>,
  state: EditorState,
  dispatch: React.Dispatch<EditorAction>,
) {
  // Always read the latest state without re-attaching the listener on every change.
  const latest = React.useRef({ state, dispatch });
  latest.current = { state, dispatch };

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const editorRoot = root;

    function onKeyDown(event: KeyboardEvent) {
      const { state, dispatch } = latest.current;
      const key = event.key;
      const target = event.target as HTMLElement | null;
      if (target?.closest(TYPING)) return;
      // Inside the layers list plain Up/Down move focus between layers, so they must not also
      // nudge. Everything else (Left/Right, and any Shift+arrow) still nudges from there.
      if (
        (key === 'ArrowUp' || key === 'ArrowDown') &&
        !event.shiftKey &&
        target?.closest('[data-layers-list]')
      ) {
        return;
      }

      const mod = event.ctrlKey || event.metaKey;

      if (mod && key.toLowerCase() === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'REDO' : 'UNDO' });
        return;
      }
      if (mod && key.toLowerCase() === 'y') {
        event.preventDefault();
        dispatch({ type: 'REDO' });
        return;
      }
      if (mod || event.altKey) return;

      const id = state.selectedId;
      const step = event.shiftKey ? NUDGE_BIG_MM : NUDGE_MM;
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };

      if (key in arrows && id) {
        event.preventDefault();
        const [dxMm, dyMm] = arrows[key] as [number, number];
        dispatch({ type: 'MOVE_BY', id, dxMm, dyMm });
      } else if ((key === 'Delete' || key === 'Backspace') && id) {
        event.preventDefault();
        dispatch({ type: 'REMOVE_ELEMENT', id });
        // The focused layer/element is about to disappear; without this, focus drops to the page
        // and the next Ctrl+Z (undo the delete) would not be heard by the editor.
        editorRoot.focus({ preventScroll: true });
      } else if (key === 'Escape') {
        dispatch({ type: 'SELECT', id: null });
      } else if (key === '[' || key === ']') {
        const layers = elementsOf(state.draft, state.side);
        if (layers.length === 0) return;
        event.preventDefault();
        const at = layers.findIndex((el) => el.id === id);
        const next = key === ']' ? (at < 0 ? 0 : at + 1) : at <= 0 ? layers.length - 1 : at - 1;
        dispatch({ type: 'SELECT', id: layers[(next + layers.length) % layers.length]!.id });
      }
    }

    root.addEventListener('keydown', onKeyDown);
    return () => root.removeEventListener('keydown', onKeyDown);
  }, [rootRef]);
}
