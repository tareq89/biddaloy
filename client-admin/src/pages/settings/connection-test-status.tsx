/**
 * Pieces shared by the four channel cards (SMS, WhatsApp, Messenger, Email):
 * the "set up" badge, the translated test-connection result and the footer
 * (test button + results) that sits left of the Save button.
 *
 * D9: the server's `message` is never shown — only a translated badge. (The
 * shared `ConnectionTestResultMessage` still prints it for the calendar feed
 * card, which another lane owns, so this is a separate file.)
 */
import { Button, StatusBadge } from '@biddaloy/ui/components';
import type { MaskedSmsSettings } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PlugZapIcon } from 'lucide-react';

import { SettingsSaved } from './settings-layout';
import { SettingsMutationError } from './settings-mutation-error';

/** One rule for "SMS is set up", shared by the SMS badge and the Evaluations card. */
export function isSmsReady(sms: MaskedSmsSettings | undefined): boolean {
  return sms?.provider === 'mimsms'
    ? Boolean(sms.mimsms?.apiKey?.configured && sms.mimsms.senderId)
    : Boolean(sms?.greenweb?.apiKey?.configured);
}

export function ChannelStatusBadge({ ready }: { ready: boolean }) {
  const { t } = useTranslation('settings');
  return (
    <StatusBadge
      tone={ready ? 'success' : 'neutral'}
      label={t(ready ? 'channelStatus.ready' : 'channelStatus.notReady')}
    />
  );
}

export function ConnectionTestStatus({
  data,
  isError,
  error,
}: {
  data: { success: boolean } | undefined;
  isError: boolean;
  error: unknown;
}) {
  const { t } = useTranslation('settings');
  return (
    <>
      {data && (
        <p role="status">
          <StatusBadge
            tone={data.success ? 'success' : 'danger'}
            label={t(data.success ? 'testConnection.success' : 'testConnection.failure')}
          />
        </p>
      )}
      {isError && <SettingsMutationError error={error} />}
    </>
  );
}

interface Mutationish {
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
}

/** `footerStart` of a channel card: test button, its result, then the save result. */
export function ChannelFooter({
  onTest,
  test,
  update,
}: {
  onTest: () => void;
  test: Mutationish & { data: { success: boolean } | undefined };
  update: Mutationish;
}) {
  const { t } = useTranslation('settings');
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-full md:w-auto"
        loading={test.isPending}
        onClick={onTest}
      >
        <PlugZapIcon aria-hidden="true" />
        {t('testConnection.action')}
      </Button>
      <ConnectionTestStatus data={test.data} isError={test.isError} error={test.error} />
      {update.isSuccess && <SettingsSaved />}
      {update.isError && <SettingsMutationError error={update.error} />}
    </>
  );
}
