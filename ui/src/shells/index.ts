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
