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
export { StatusBadge, type StatusBadgeProps, type StatusTone } from './status-badge';
export { EmptyState, type EmptyStateProps } from './empty-state';
export { ErrorState, type ErrorStateProps } from './error-state';
export { Toaster, toast } from './toast';
export { Skeleton } from './skeleton';
export { Pagination, type PaginationProps } from './pagination';
export { LocaleSwitcher, type LocaleSwitcherProps } from './locale-switcher';
export { AppShell, type AppShellProps, type AppShellNavItem } from './app-shell';
export {
  SignInForm,
  type SignInCredentials,
  type SignInFormError,
  type SignInFormProps,
} from './sign-in-form';
