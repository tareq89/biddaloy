/**
 * Public component surface — one wrapper per vendored primitive. SPAs import from here and never reach into `primitives/`.
 *
 * `Placeholder` exists only to prove the `@biddaloy/ui` import boundary
 * works end to end for [8.1.4]'s scaffold check. Real components arrived
 * with [8.6.2]'s core wrappers below — `Placeholder` can be deleted now
 * that something real proves the boundary, but that deletion is left for a
 * human to action rather than done here (see this PR's Notes section).
 */
export { Placeholder } from './placeholder';

export { Button, type ButtonProps } from './button';
export { Input, type InputProps } from './input';
export { Textarea, type TextareaProps } from './textarea';
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  type TableBodyProps,
  type TableCaptionProps,
  type TableCellProps,
  type TableFooterProps,
  type TableHeadProps,
  type TableHeaderProps,
  type TableProps,
  type TableRowProps,
} from './table';
export { Label, type LabelProps } from './label';
export { Checkbox, type CheckboxProps } from './checkbox';
export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
} from './form-field';
export { MoneyInput, type MoneyInputProps } from './money-input';
export { PhoneInput, formatValidPhone, type PhoneInputProps } from './phone-input';
export { DatePicker, Calendar, type DatePickerProps } from './date-picker';
export { Combobox, type ComboboxOption, type ComboboxProps } from './combobox';
export { FileUpload, type FileUploadItem, type FileUploadProps } from './file-upload';
export {
  DataTable,
  type DataTableColumn,
  type DataTableProps,
  type DataTableSort,
} from './data-table';
export {
  RadioGroup,
  RadioGroupItem,
  type RadioGroupProps,
  type RadioGroupItemProps,
} from './radio';
export { SchoolPicker, type SchoolPickerOption, type SchoolPickerProps } from './school-picker';
export { TenantBar } from './tenant-bar';
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  type SelectProps,
  type SelectTriggerProps,
  type SelectContentProps,
  type SelectItemProps,
  type SelectValueProps,
  type SelectGroupProps,
  type SelectLabelProps,
  type SelectSeparatorProps,
} from './select';
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  type DialogProps,
  type DialogTriggerProps,
  type DialogContentProps,
  type DialogHeaderProps,
  type DialogFooterProps,
  type DialogTitleProps,
  type DialogDescriptionProps,
  type DialogCloseProps,
} from './dialog';
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  type TooltipProps,
  type TooltipTriggerProps,
  type TooltipContentProps,
  type TooltipProviderProps,
} from './tooltip';
export {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  type MenuProps,
  type MenuTriggerProps,
  type MenuContentProps,
  type MenuItemProps,
  type MenuCheckboxItemProps,
  type MenuRadioGroupProps,
  type MenuRadioItemProps,
  type MenuLabelProps,
  type MenuSeparatorProps,
  type MenuShortcutProps,
  type MenuGroupProps,
  type MenuSubProps,
  type MenuSubTriggerProps,
  type MenuSubContentProps,
} from './menu';
export {
  StatusBadge,
  humanizeStatus,
  type StatusBadgeProps,
  type StatusTone,
} from './status-badge';
export { Card, type CardProps } from './card';
export { BottomNav, type BottomNavProps } from './bottom-nav';
export { EmptyState, type EmptyStateProps } from './empty-state';
export { StudentPicker, type StudentPickerProps, type StudentPickerItem } from './student-picker';
export { ErrorState, type ErrorStateProps } from './error-state';
export { RouteStatusState, type RouteStatusStateProps } from './route-status-state';
export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  type PopoverProps,
  type PopoverAnchorProps,
  type PopoverContentProps,
  type PopoverDescriptionProps,
  type PopoverHeaderProps,
  type PopoverTitleProps,
  type PopoverTriggerProps,
} from './popover';
export { NotificationBell, type NotificationBellProps } from './notification-bell';
export { RouteErrorFallback, type RouteErrorFallbackProps } from './route-error-boundary';
export { Toaster, toast } from './toast';
export { Skeleton } from './skeleton';
export { Pagination, type PaginationProps } from './pagination';
export { LocaleSwitcher, type LocaleSwitcherProps } from './locale-switcher';
export {
  AppShell,
  APP_SHELL_MAIN_ID,
  type AppShellProps,
  type AppShellNavItem,
  type AppShellNavGroup,
} from './app-shell';
export { SkipLink, type SkipLinkProps } from './skip-link';
export { RouteAnnouncer, type RouteAnnouncerProps } from './route-announcer';
export {
  GlobalSearch,
  type GlobalSearchProps,
  type GlobalSearchGroup,
  type GlobalSearchResult,
} from './global-search';
export {
  SignInForm,
  type SignInCredentials,
  type SignInFormError,
  type SignInFormProps,
} from './sign-in-form';
