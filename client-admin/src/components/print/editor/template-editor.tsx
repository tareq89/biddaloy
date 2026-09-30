/**
 * [32.3.1, 32.3.2] The full-screen template editor (D3, D31, D36). Place, move, resize
 * and style elements on one side of a template with the mouse OR the keyboard; set up
 * the page, upload artwork / images / fonts, preview with sample or longest values, and
 * publish. The draft autosaves. It is a component only: the route that mounts it
 * (32.4.1) supplies `onExit`.
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
  type PrintFont,
} from '@biddaloy/ui/components';
import {
  usePrintAssets,
  usePrintTemplate,
  useUpdatePrintTemplate,
  type PrintTemplateRow,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { useDataUrls } from '../preview/use-data-urls';

import { AssetsPanel } from './assets-panel';
import { DpiBadge } from './dpi-badge';
import { EditorCanvas } from './editor-canvas';
import {
  createElement,
  createImageFromAsset,
  editorReducer,
  elementsOf,
  initEditorState,
  type NewElementType,
} from './editor-state';
import { LayersPanel } from './layers-panel';
import { PageSetupPanel } from './page-setup-panel';
import { PropertiesPanel } from './properties-panel';
import { PublishButton } from './publish-button';
import { SampleDataBar } from './sample-data-bar';
import { useDraftAutosave } from './use-draft-autosave';
import { useEditorKeyboard } from './use-editor-keyboard';

export interface TemplateEditorProps {
  templateId: string;
  /** Leave the editor (the route navigates). Asked to confirm first if there is unsaved work. */
  onExit: () => void;
  /** Replaces the built-in Publish button (rarely needed). */
  publishSlot?: React.ReactNode;
}

type LeftTab = 'layers' | 'page' | 'assets';

/** Stand-in text for every data field, so the canvas looks like a real card (images stay blank). */
function fieldValues(kind: DocumentKind, longest: boolean): Record<string, string> {
  return Object.fromEntries(
    (FIELD_CATALOG[kind] ?? []).map((f) => [
      f.key,
      f.type === 'image' ? '' : longest ? (f.longestSample ?? f.sample) : f.sample,
    ]),
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
  const updateTemplate = useUpdatePrintTemplate(templateId);

  const [tab, setTab] = React.useState<LeftTab>('layers');
  const [leaving, setLeaving] = React.useState(false);
  const [leaveError, setLeaveError] = React.useState(false);
  const [longest, setLongest] = React.useState(false);
  const [sample, setSample] = React.useState<Record<string, string> | null>(null);

  // --- uploaded files: metadata for badges/fonts, and data URLs so the canvas can show them
  const assets = (usePrintAssets().data ?? []).filter((a) => a.archived_at === null);
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const fileUrl = (id: string) => `/print-assets/${id}/file`;
  const draftAssetIds = [
    state.draft.front.background?.assetId,
    state.draft.back?.background?.assetId,
    ...[...state.draft.front.elements, ...(state.draft.back?.elements ?? [])].map((el) =>
      el.type === 'IMAGE' ? el.assetId : undefined,
    ),
  ].filter((id): id is string => Boolean(id));
  const fontAssets = assets.filter((a) => a.asset_kind === 'FONT');
  const dataUrls = useDataUrls([...draftAssetIds, ...fontAssets.map((a) => a.id)].map(fileUrl));
  const assetUrl = (id: string) => dataUrls[fileUrl(id)] ?? '';
  const fonts: PrintFont[] = [
    ...BUNDLED_PRINT_FONTS,
    ...fontAssets.flatMap((a) =>
      a.font_family && dataUrls[fileUrl(a.id)]
        ? [{ family: a.font_family, url: dataUrls[fileUrl(a.id)] as string }]
        : [],
    ),
  ];
  const extraFonts = [
    ...new Set(fontAssets.flatMap((a) => (a.font_family ? [a.font_family] : []))),
  ];

  const values = React.useMemo(
    () => ({
      ...fieldValues(kind, false),
      ...(longest ? fieldValues(kind, true) : (sample ?? {})),
    }),
    [kind, longest, sample],
  );
  const elements = elementsOf(state.draft, state.side);
  const selected = elements.find((el) => el.id === state.selectedId);
  const hasBack = state.draft.page.sides.length === 2;
  const background = (state.side === 'back' ? state.draft.back : state.draft.front)?.background;

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
            className="h-6"
            min={100}
            max={400}
            step={25}
            value={state.zoom}
            onChange={(e) => dispatch({ type: 'SET_ZOOM', zoom: e.target.valueAsNumber })}
          />
          <span className="tabular-nums">{state.zoom}%</span>
        </label>

        <div className="ms-auto">
          {publishSlot ?? (
            <PublishButton
              templateId={templateId}
              kind={kind}
              draft={state.draft}
              saveStatus={autosave.status}
            />
          )}
        </div>
      </header>

      <SampleDataBar
        kind={kind}
        templateId={templateId}
        published={template.current_version_id !== null}
        longest={longest}
        onLongestChange={setLongest}
        onSample={setSample}
      />

      <div className="grid min-h-0 flex-1 grid-cols-[16rem_1fr_18rem] gap-4">
        <div className="flex flex-col gap-3">
          <div role="group" aria-label={t('tabs.group')} className="flex gap-1">
            {(['layers', 'page', 'assets'] as const).map((id) => (
              <Button
                key={id}
                type="button"
                size="sm"
                variant={tab === id ? 'default' : 'outline'}
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
              >
                {t(`tabs.${id}`)}
              </Button>
            ))}
          </div>

          {tab === 'layers' ? (
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
              badgeOf={(el) =>
                el.type === 'IMAGE' && el.assetId ? (
                  <DpiBadge
                    widthPx={assetById.get(el.assetId)?.width_px ?? null}
                    elementWidthMm={el.w}
                  />
                ) : null
              }
            />
          ) : null}
          {tab === 'page' ? (
            <PageSetupPanel
              name={template.name}
              batchSize={template.batch_size}
              page={state.draft.page}
              copyLabel={state.draft.copyLabel?.text}
              onName={(name) => updateTemplate.mutate({ name })}
              onBatchSize={(batch_size) => updateTemplate.mutate({ batch_size })}
              onPage={(page) => dispatch({ type: 'SET_PAGE', page })}
              onCopyLabel={(text) => dispatch({ type: 'SET_COPY_LABEL', text })}
            />
          ) : null}
          {tab === 'assets' ? (
            <AssetsPanel
              page={state.draft.page}
              kind={kind}
              availableFonts={[...BUNDLED_PRINT_FONTS.map((f) => f.family), ...extraFonts]}
              onImportSvg={(assetId, elements) =>
                dispatch({ type: 'IMPORT_SVG', assetId, elements })
              }
              pageWidthMm={state.draft.page.widthMm}
              background={background}
              onSetBackground={(assetId, print) =>
                dispatch({
                  type: 'SET_BACKGROUND',
                  assetId,
                  ...(print !== undefined ? { print } : {}),
                })
              }
              onInsertImage={(assetId) =>
                dispatch({
                  type: 'ADD_ELEMENT',
                  element: createImageFromAsset(assetId, state.draft),
                })
              }
            />
          ) : null}
        </div>

        <EditorCanvas
          definition={state.draft}
          side={state.side}
          zoom={state.zoom}
          selectedId={state.selectedId}
          values={values}
          assetUrl={assetUrl}
          fonts={fonts}
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
