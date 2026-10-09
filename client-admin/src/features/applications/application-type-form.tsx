/**
 * [52.4.2] One form for all ten application types. It owns the fields and their
 * validation and hands back the exact `payload` of `POST /applications`; the
 * host page owns the submit button (`formId`, like the homework form) and the
 * mutation, passing a failure back as `error` so it reads as a sentence.
 */
import type { ApplicationType } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import { Card, Form } from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm, type FieldValues } from 'react-hook-form';

import {
  APPLICATION_FORMS,
  type ApplicationPayload,
  type ApplicationSubject,
} from './forms/registry';

export type { ApplicationPayload, ApplicationSubject } from './forms/registry';

export interface ApplicationTypeFormProps {
  type: ApplicationType;
  subject: ApplicationSubject;
  /** Put on the `<form id>`: the host footer's primary calls `requestSubmit()` on it. */
  formId: string;
  /** Back-navigation keeps what was typed. */
  defaultValues?: Partial<ApplicationPayload>;
  /** The payload exactly as `POST /applications` takes it. */
  onSubmit: (payload: ApplicationPayload) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** While the host is sending. */
  disabled?: boolean;
  /** The host mutation's error; known `details.code`s get their own sentence. */
  error?: unknown;
}

const KNOWN_CODES = ['LEAVE_OVERLAP', 'LEAVE_NO_WORKING_DAYS', 'APPLICATION_ADDRESSEE_INVALID'];

/** A translated sentence, never the server's own text. */
function useServerMessage(error: unknown): string | undefined {
  const { t } = useTranslation('applicationForms');
  if (!error) return undefined;
  const code = error instanceof ApiError ? (error.details as { code?: string })?.code : undefined;
  return code && KNOWN_CODES.includes(code) ? t(`errors.${code}`) : t('errors.server');
}

/** `key={type}`: a different type is a different form, never a patched one. */
export function ApplicationTypeForm(props: ApplicationTypeFormProps) {
  return <TypeForm key={props.type} {...props} />;
}

function TypeForm({
  type,
  subject,
  formId,
  defaultValues,
  onSubmit,
  onDirtyChange,
  disabled = false,
  error,
}: ApplicationTypeFormProps) {
  const { t } = useTranslation('applicationForms');
  const { t: tApp } = useTranslation('applications');
  const regionConfig = useRegionConfig();
  const def = APPLICATION_FORMS[type];
  const schema = React.useMemo(() => def.schema(t, regionConfig), [def, t, regionConfig]);
  const form = useForm<FieldValues>({
    resolver: zodResolver(schema),
    defaultValues: { ...def.defaults(subject, defaultValues), ...defaultValues },
  });
  const serverMessage = useServerMessage(error);

  const dirty = form.formState.isDirty;
  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  return (
    <Form {...form}>
      <form
        id={formId}
        noValidate
        onSubmit={(event) =>
          void form.handleSubmit((values) => onSubmit(values as unknown as ApplicationPayload))(
            event,
          )
        }
      >
        <Card padded className="flex flex-col gap-4">
          <h2 className="text-h2">{tApp(`types.${type}`)}</h2>
          {serverMessage && (
            <p role="alert" className="text-sm text-destructive">
              {serverMessage}
            </p>
          )}
          <fieldset
            disabled={disabled}
            className="m-0 grid min-w-0 gap-4 border-0 p-0 md:grid-cols-2"
          >
            <def.Fields subject={subject} />
          </fieldset>
        </Card>
      </form>
    </Form>
  );
}
