/**
 * [32.3.1] The full-screen template editor (D3, D31, D36). Place, move, resize and
 * style elements on one side of a template with the mouse OR the keyboard; the draft
 * autosaves. It is a component only: the route that mounts it (32.4.1) supplies
 * `onExit`, and #1147 fills `publishSlot` with the Publish button.
 */
import { FIELD_CATALOG, type DocumentKind } from '@biddaloy/shared';
import {
  BUNDLED_PRINT_FONTS,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Skeleton,
} from '@biddaloy/ui/components';
import { usePrintTemplate, type PrintTemplateRow } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { EditorCanvas } from './editor-canvas';
import {
  createElement,
  editorReducer,
  elementsOf,
  initEditorState,
  type NewElementType,
} from './editor-state';
import { LayersPanel } from './layers-panel';
import { PropertiesPanel } from './properties-panel';
import { useDraftAutosave } from './use-draft-autosave';
import { useEditorKeyboard } from './use-editor-keyboard';

export interface TemplateEditorProps {
  templateId: string;
  /** Leave the editor (the route navigates). Asked to confirm first if there is unsaved work. */
  onExit: () => void;
  /** Where #1147 puts the Publish button. */
  publishSlot?: React.ReactNode;
  /** Uploaded font families, added to the bundled ones (from #1147). */
  extraFonts?: string[];
  /** Resolves an uploaded asset id to something an `<img>` can show (a data URL). */
  assetUrl?: (assetId: string) => string;
}

/** Sample text for every data field, so the canvas looks like a real card (images stay blank). */
function sampleValues(kind: DocumentKind): Record<string, string> {
  return Object.fromEntries(
    (FIELD_CATALOG[kind] ?? []).map((f) => [f.key, f.type === 'image' ? '' : f.sample]),
  );
}

export function TemplateEditor(props: TemplateEditorProps) {
  const { t } = useTranslation('printEditor');
  const query = usePrintTemplate(props.templateId);

  if (query.isPending) {
    return <Skeleton role="status" aria-label={t('loading')} className="h-96 w-full" />;
  }
  if (query.isError || !query.data.draft) {
    return <ErrorState message={t('loadError')} onRetry={() => void query.refetch()} />;
  }
  // Keyed by id: opening another template starts a fresh editor and history.
  return <EditorBody key={props.templateId} {...props} template={query.data} />;
}

function EditorBody({
  templateId,
  onExit,
  publishSlot,
  extraFonts = [],
  assetUrl = () => '',
  template,
}: TemplateEditorProps & { template: PrintTemplateRow }) {
  const { t } = useTranslation('printEditor');
  const kind = template.document_kind;
  const serverDraft = template.draft as NonNullable<PrintTemplateRow['draft']>;

  const [state, dispatch] = React.useReducer(editorReducer, undefined, () =>
    initEditorState(serverDraft, kind),
  );
  const rootRef = React.useRef<HTMLDivElement>(null);
  useEditorKeyboard(rootRef, state, dispatch);
  const autosave = useDraftAutosave(templateId, state.draft, serverDraft);
  const [leaving, setLeaving] = React.useState(false);
  const [leaveError, setLeaveError] = React.useState(false);

  const values = React.useMemo(() => sampleValues(kind), [kind]);
  const elements = elementsOf(state.draft, state.side);
  const selected = elements.find((el) => el.id === state.selectedId);
  const hasBack = state.draft.page.sides.length === 2;

  function requestExit() {
    if (autosave.hasUnsaved) setLeaving(true);
    else onExit();
  }

  async function saveAndLeave() {
    setLeaveError(false);
    try {
      await autosave.flush();
      onExit();
    } catch {
      setLeaveError(true);
    }
  }

  return (
    <div ref={rootRef} tabIndex={-1} className="flex h-full flex-col gap-3 outline-none">
      <header className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={requestExit}>
          {t('topbar.exit')}
        </Button>
        <h1 className="text-base font-semibold">{template.name}</h1>

        <p role="status" className="text-sm text-muted-foreground">
          {t(`topbar.status.${autosave.status}`)}
          {autosave.status === 'error' ? (
            <Button type="button" variant="link" size="sm" onClick={autosave.retry}>
              {t('topbar.retry')}
            </Button>
          ) : null}
        </p>

        {hasBack ? (
          <div role="group" aria-label={t('topbar.sideGroup')} className="flex gap-1">
            {(['front', 'back'] as const).map((side) => (
              <Button
                key={side}
                type="button"
                size="sm"
                variant={state.side === side ? 'default' : 'outline'}
                aria-pressed={state.side === side}
                onClick={() => dispatch({ type: 'SET_SIDE', side })}
              >
                {t(`topbar.${side}`)}
              </Button>
            ))}
          </div>
        ) : null}

        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={state.past.length === 0}
          onClick={() => dispatch({ type: 'UNDO' })}
        >
          {t('topbar.undo')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={state.future.length === 0}
          onClick={() => dispatch({ type: 'REDO' })}
        >
          {t('topbar.redo')}
        </Button>

        <label className="flex items-center gap-2 text-sm">
          {t('topbar.zoom')}
          <input
            type="range"
            min={100}
            max={400}
            step={25}
            value={state.zoom}
            onChange={(e) => dispatch({ type: 'SET_ZOOM', zoom: e.target.valueAsNumber })}
          />
          <span className="tabular-nums">{state.zoom}%</span>
        </label>

        <div className="ms-auto">{publishSlot}</div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[14rem_1fr_18rem] gap-4">
        <LayersPanel
          elements={elements}
          selectedId={state.selectedId}
          onSelect={(id) => dispatch({ type: 'SELECT', id })}
          onAdd={(type: NewElementType) =>
            dispatch({ type: 'ADD_ELEMENT', element: createElement(type, state.draft, kind) })
          }
          onRemove={(id) => dispatch({ type: 'REMOVE_ELEMENT', id })}
          onMove={(id, delta) => {
            const at = elements.findIndex((el) => el.id === id);
            dispatch({ type: 'REORDER_ELEMENT', id, toIndex: at + delta });
          }}
        />

        <EditorCanvas
          definition={state.draft}
          side={state.side}
          zoom={state.zoom}
          selectedId={state.selectedId}
          values={values}
          assetUrl={assetUrl}
          fonts={BUNDLED_PRINT_FONTS}
          onSelect={(id) => dispatch({ type: 'SELECT', id })}
          onCommitRect={(id, rect) => dispatch({ type: 'SET_RECT', id, rect })}
        />

        <PropertiesPanel
          element={selected}
          kind={kind}
          extraFonts={extraFonts}
          onChange={(patch) =>
            selected && dispatch({ type: 'UPDATE_ELEMENT', id: selected.id, patch })
          }
        />
      </div>

      <Dialog open={leaving} onOpenChange={setLeaving}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('exitDialog.title')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm">{t('exitDialog.body')}</p>
          {leaveError ? (
            <p role="alert" className="text-sm text-destructive">
              {t('exitDialog.saveFailed')}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLeaving(false)}>
              {t('exitDialog.stay')}
            </Button>
            <Button type="button" variant="outline" onClick={onExit}>
              {t('exitDialog.leaveAnyway')}
            </Button>
            <Button type="button" onClick={() => void saveAndLeave()}>
              {t('exitDialog.saveAndLeave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
