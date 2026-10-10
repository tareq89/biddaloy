/**
 * [52.4.2] D48: the server is the only letter renderer, in the school's language (D40).
 * This asks it and shows the answer; the client never builds letter wording.
 */
import { ErrorState, Skeleton } from '@biddaloy/ui/components';
import { useApplicationLetterPreview, type LetterPreviewDto } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import { LetterPreview } from './letter-preview';

export function DraftLetterPreview({ input }: { input: LetterPreviewDto }) {
  const { t } = useTranslation('applicationForms');
  const preview = useApplicationLetterPreview(input);

  if (preview.isError) {
    return <ErrorState message={t('preview.loadError')} onRetry={() => void preview.refetch()} />;
  }
  if (!preview.data) {
    return (
      <div
        aria-busy="true"
        className="space-y-3 rounded-md border border-border-subtle bg-bg p-4 md:p-6"
      >
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  // A new input keeps the last letter on screen (`keepPreviousData`), marked busy, instead of
  // flashing the skeleton. The host passes a settled input, not every keystroke.
  return (
    <div aria-busy={preview.isPlaceholderData || undefined}>
      <LetterPreview draft text={preview.data.letter_text} />
    </div>
  );
}
