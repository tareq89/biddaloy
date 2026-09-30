/**
 * [32.3.1] Autosaves the working draft (D36). 1.5 s after the last change it sends
 * `PATCH { draft }`, and reports Saving… / Saved / Couldn't save — retry. The
 * server keeps only the DRAFT here; publishing is a separate, deliberate step.
 *
 * `hasUnsaved` is true from the first unsaved change until the save lands (or fails),
 * so the caller can warn before the person leaves and loses work.
 */
import type { TemplateDefinition } from '@biddaloy/shared';
import { useUpdatePrintTemplate } from '@biddaloy/ui/hooks';
import * as React from 'react';

export const AUTOSAVE_DELAY_MS = 1500;

export type AutosaveStatus = 'saved' | 'pending' | 'saving' | 'error';

export interface DraftAutosave {
  status: AutosaveStatus;
  hasUnsaved: boolean;
  /** Save right now (skips the wait). Resolves when done; rejects if the save failed. */
  flush: () => Promise<void>;
  retry: () => void;
}

export function useDraftAutosave(
  templateId: string,
  draft: TemplateDefinition,
  serverDraft: TemplateDefinition | undefined,
  delayMs = AUTOSAVE_DELAY_MS,
): DraftAutosave {
  const { mutateAsync } = useUpdatePrintTemplate(templateId);
  // What the server is known to hold; anything else in `draft` is unsaved.
  const saved = React.useRef<TemplateDefinition | undefined>(serverDraft);
  const [status, setStatus] = React.useState<AutosaveStatus>('saved');
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlight = React.useRef<Promise<void> | undefined>(undefined);
  const latest = React.useRef(draft);
  latest.current = draft;

  const save = React.useCallback((): Promise<void> => {
    clearTimeout(timer.current);
    const toSave = latest.current;
    if (toSave === saved.current) {
      setStatus('saved');
      return Promise.resolve();
    }
    setStatus('saving');
    const run = mutateAsync({ draft: toSave }).then(
      () => {
        saved.current = toSave;
        // More edits arrived while this save was in flight: save those too.
        if (latest.current !== toSave) return save();
        setStatus('saved');
      },
      (error: unknown) => {
        setStatus('error');
        throw error;
      },
    );
    inFlight.current = run;
    return run;
  }, [mutateAsync]);

  React.useEffect(() => {
    if (draft === saved.current) return;
    setStatus((s) => (s === 'saving' ? s : 'pending'));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      // Errors surface through `status`; nothing to do with the rejection here.
      save().catch(() => undefined);
    }, delayMs);
    return () => clearTimeout(timer.current);
  }, [draft, delayMs, save]);

  // A browser refresh / tab close with unsaved work asks first.
  const hasUnsaved = status !== 'saved';
  React.useEffect(() => {
    if (!hasUnsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsaved]);

  return {
    status,
    hasUnsaved,
    flush: save,
    retry: () => void save().catch(() => undefined),
  };
}
