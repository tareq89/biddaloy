/**
 * The four page shells: ListShell, DetailShell, WizardShell, FormShell.
 */
export { ListShell, type ListShellProps } from './list-shell';
export {
  useListShellState,
  type ListShellState,
  type ListShellActions,
} from './use-list-shell-state';
export {
  DetailShell,
  type DetailShellProps,
  type DetailShellAction,
  type DetailShellTab,
} from './detail-shell';
export { useDetailShellTab } from './use-detail-shell-tab';
export { WizardShell, type WizardShellProps, type WizardStep } from './wizard-shell';
export { useWizardShellStep } from './use-wizard-shell-step';
export {
  FormShell,
  FormSection,
  type FormShellProps,
  type FormShellError,
  type FormSectionProps,
} from './form-shell';
export {
  useFormShellMode,
  applyServerFieldErrors,
  useWarnUnsavedChanges,
  useFormAutosave,
  type UseFormAutosaveResult,
} from './use-form-shell';
