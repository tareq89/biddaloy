import { Button } from '@biddaloy/ui/components';
import type { MaskedSecret } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

/**
 * The one place #8.7.13's "credentials are write-only" contract becomes
 * UI: a secret never renders as a value, only as *state* — "Configured —
 * ends 4821" — with Replace/Clear actions, exactly the issue's own
 * acceptance criterion. There is deliberately no way to reveal the
 * plaintext here, because the API never sends it back to reveal.
 *
 * `value` mirrors the three states a PATCH body can express for a secret
 * field (see `tenant-settings.dto.ts`'s own comment on the same contract):
 * - `undefined` — unchanged, omitted from the save entirely.
 * - `null` — explicitly cleared.
 * - a non-empty string — a fresh plaintext value about to be encrypted.
 * `''` is deliberately not one of these three states: whether the input
 * is currently empty is tracked as local `isEditing` UI state instead
 * (below), not surfaced to the caller through `value` at all. Clicking
 * "Replace" used to call `onChange('')` to enter editing mode, which made
 * an untouched edit box indistinguishable from "the user typed and then
 * cleared it" — submitting `''` as if it were a real value, silently
 * overwriting the stored secret with an empty, unencrypted string. Now an
 * edit box that's never had anything typed into it keeps `value` at
 * `undefined` for its entire life, so Save with nothing typed submits
 * nothing, same as never having clicked "Replace" at all.
 *
 * Not wired through `FormField`/`FormControl` like the plain-text fields
 * next to it — `FormControl` merges its `id`/`aria-*` props onto a
 * *single* child element (Radix `Slot`), and this widget's editing state
 * needs to render an input alongside a Cancel button, two elements. It
 * manages its own `id`/`<label htmlFor>` pairing directly instead; a
 * parent section keeps this field's value in local `useState` rather than
 * under `react-hook-form` for the same reason (see e.g.
 * `WhatsAppSection.tsx`).
 *
 * Clicking "Replace"/"Set" switches straight to editing (no separate
 * "reveal" step, since there's nothing to reveal); "Cancel" reverts to
 * `undefined` — the caller doesn't need to remember to reset it. The
 * connection-test flow reads the same `value` a save would submit, so
 * typing a replacement and clicking "Test connection" (before saving)
 * tests exactly the value that would be saved.
 */
export interface SecretFieldProps {
  id: string;
  label: string;
  masked: MaskedSecret | undefined;
  value: string | null | undefined;
  onChange: (value: string | null | undefined) => void;
  onBlur?: () => void;
}

export function SecretField({ id, label, masked, value, onChange, onBlur }: SecretFieldProps) {
  const { t } = useTranslation('settings');
  const [isEditing, setIsEditing] = React.useState(false);
  const isCleared = value === null;
  const statusId = `${id}-status`;

  function startEditing() {
    setIsEditing(true);
  }

  function cancelEditing() {
    setIsEditing(false);
    onChange(undefined);
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    // An empty box means "nothing typed" regardless of whether the user
    // typed-then-deleted or never touched it — both submit nothing.
    onChange(event.target.value === '' ? undefined : event.target.value);
  }

  return (
    <div className="grid gap-1.5">
      <label htmlFor={isEditing ? id : statusId} className="text-sm font-medium">
        {label}
      </label>
      {isEditing ? (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="password"
            autoComplete="new-password"
            className="h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            value={value ?? ''}
            onChange={handleChange}
            onBlur={onBlur}
          />
          <Button type="button" variant="ghost" size="sm" onClick={cancelEditing}>
            {t('secret.cancel')}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span id={statusId} className="flex-1 text-sm text-muted-foreground">
            {isCleared || !masked?.configured
              ? t('secret.notConfigured')
              : masked.hint
                ? t('secret.configured', { hint: masked.hint })
                : t('secret.configuredNoHint')}
          </span>
          {/* No `id` here — this button shares `label`'s `htmlFor` with
              the status `<span>` above (or the editing-mode `<input>`
              once editing starts), and a <label for> on a <button>
              replaces its accessible name with the label's text instead
              of its own ("Access token" instead of "Replace"). This
              button's own visible text is its name. */}
          <Button type="button" variant="outline" size="sm" onClick={startEditing}>
            {isCleared || !masked?.configured ? t('secret.set') : t('secret.replace')}
          </Button>
          {!isCleared && masked?.configured && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              {t('secret.clear')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
